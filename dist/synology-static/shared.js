(function (w) {
  function getMesConfig() {
    return w.MES_CONFIG || {};
  }

  function isPrivateIpv4Host(hostname) {
    const match = String(hostname || "").match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!match) return false;
    const parts = match.slice(1).map((item) => Number(item));
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }

  function normalizeUploadApiBase(raw, baseHref) {
    const text = String(raw || "").trim();
    if (!text) return "";
    try {
      const url = new URL(text, baseHref || w.location.href);
      const protocol = String(url.protocol || "").toLowerCase();
      const host = String(url.hostname || "").toLowerCase();
      if (protocol === "https:") return url.href.replace(/\/+$/, "");
      if (
        protocol === "http:" &&
        (host === "localhost" || host === "127.0.0.1" || host === "::1" || isPrivateIpv4Host(host))
      ) {
        return url.href.replace(/\/+$/, "");
      }
      console.warn("UPLOAD_API_BASE 已忽略：仅允许 https，或局域网/本机 http。", text);
      return "";
    } catch (_error) {
      console.warn("UPLOAD_API_BASE 格式无效，已忽略。", text);
      return "";
    }
  }

  function createSupabaseClient(config, supabaseLib) {
    const resolvedConfig = config && typeof config === "object" ? config : getMesConfig();
    const library = supabaseLib || w.supabase;
    const remoteEnabled = Boolean(
      resolvedConfig.SUPABASE_URL && resolvedConfig.SUPABASE_ANON_KEY && library && typeof library.createClient === "function"
    );
    return {
      remoteEnabled,
      db: remoteEnabled ? library.createClient(resolvedConfig.SUPABASE_URL, resolvedConfig.SUPABASE_ANON_KEY) : null,
    };
  }

  function createBufferedJsonStorage(storageKey, getValue, storage) {
    const targetStorage = storage || w.localStorage;
    let pendingTimer = 0;
    let dirty = false;

    function flush() {
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = 0;
      }
      if (!dirty) return;
      dirty = false;
      targetStorage.setItem(storageKey, JSON.stringify(getValue()));
    }

    function schedule(delayMs) {
      if (pendingTimer) return;
      pendingTimer = w.setTimeout(() => {
        pendingTimer = 0;
        flush();
      }, Math.max(0, Number(delayMs) || 0));
    }

    return {
      save(options = {}) {
        const immediate = Boolean(options.immediate);
        const delayMs = options.delayMs == null ? 120 : options.delayMs;
        dirty = true;
        if (immediate) {
          flush();
          return;
        }
        schedule(delayMs);
      },
      flush,
    };
  }

  function loadJsonList(storageKey, options = {}) {
    const storage = options.storage || w.localStorage;
    const fallback = typeof options.fallback === "function" ? options.fallback : () => [];
    const mapItem = typeof options.mapItem === "function" ? options.mapItem : (item) => item;
    const onError = typeof options.onError === "function" ? options.onError : null;
    const raw = storage.getItem(storageKey);
    if (!raw) return fallback();
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return fallback();
      return parsed.map((item, index) => mapItem(item, index));
    } catch (error) {
      if (onError) onError(error);
      return fallback();
    }
  }

  function applyStaticSeed(options = {}) {
    const storage = options.storage || w.localStorage;
    const allowKeys = Array.isArray(options.allowKeys) ? new Set(options.allowKeys.map((item) => String(item))) : null;
    const force = Boolean(options.force);
    const preferExisting = options.preferExisting !== false;
    const seed = w.__MES_STATIC_SEED__;
    if (!seed || typeof seed !== "object") return { appliedCount: 0, totalCount: 0, reason: "missing_seed" };
    const keyMap = seed.keys && typeof seed.keys === "object" ? seed.keys : {};
    const markerKey = String(seed.markerKey || "__mes_static_seed_version__");
    const version = String(seed.version || "");
    const appliedVersion = String(storage.getItem(markerKey) || "");
    if (!force && version && appliedVersion === version) {
      return { appliedCount: 0, totalCount: 0, reason: "already_applied" };
    }

    let totalCount = 0;
    let appliedCount = 0;
    Object.keys(keyMap).forEach((key) => {
      const normalizedKey = String(key || "");
      if (!normalizedKey) return;
      if (allowKeys && !allowKeys.has(normalizedKey)) return;
      totalCount += 1;
      const existing = storage.getItem(normalizedKey);
      if (!force && preferExisting && existing) return;
      try {
        storage.setItem(normalizedKey, JSON.stringify(keyMap[key]));
        appliedCount += 1;
      } catch (error) {
        console.warn(`写入静态种子失败: ${normalizedKey}`, error);
      }
    });

    if (version) {
      try {
        storage.setItem(markerKey, version);
      } catch (_error) {
        // ignore marker write failure
      }
    }
    return { appliedCount, totalCount, reason: "ok" };
  }

  function computeLatestCursor(list = [], getCursorValue) {
    const pickValue = typeof getCursorValue === "function"
      ? getCursorValue
      : (row) => String(row?.updatedAt || row?.createdAt || "");
    return list.reduce((max, row) => {
      const value = String(pickValue(row) || "");
      return value > max ? value : max;
    }, "");
  }

  async function fetchSupabaseRows(options) {
    const settings = options && typeof options === "object" ? options : {};
    const db = settings.db;
    const tableName = String(settings.tableName || "").trim();
    const select = settings.select || "*";
    const orderBy = String(settings.orderBy || "updated_at").trim();
    const ascending = settings.ascending !== false;
    const cursor = settings.cursor ? String(settings.cursor) : "";
    const cursorColumn = String(settings.cursorColumn || orderBy).trim();
    const useCursor = Boolean(settings.useCursor && cursor);
    const mapRow = typeof settings.mapRow === "function" ? settings.mapRow : (row) => row;

    if (!db || !tableName) return [];

    let query = db.from(tableName).select(select).order(orderBy, { ascending });
    // Use an inclusive cursor to avoid missing rows that share the same updated_at value.
    if (useCursor) query = query.gte(cursorColumn, cursor);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((row) => mapRow(row));
  }

  async function checkAuditAdminAccess(db, email) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!db || !normalizedEmail) return false;
    const { data, error } = await db
      .from("mes_audit_admins")
      .select("email")
      .eq("email", normalizedEmail)
      .limit(1);
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  }

  async function syncSupabaseChanges(options) {
    const settings = options && typeof options === "object" ? options : {};
    const db = settings.db;
    const tableName = String(settings.tableName || "").trim();
    const changed = Array.isArray(settings.changed) ? settings.changed : [];
    const deletedId = settings.deletedId == null ? null : settings.deletedId;
    const mapChangedRow = typeof settings.mapChangedRow === "function" ? settings.mapChangedRow : (item) => item;
    const onConflict = settings.onConflict;

    if (!db || !tableName) return;

    if (changed.length > 0) {
      const payload = changed.map((item) => mapChangedRow(item));
      const query = db.from(tableName).upsert(payload, onConflict ? { onConflict } : undefined);
      const { error } = await query;
      if (error) throw error;
    }

    if (deletedId) {
      const { error } = await db.from(tableName).delete().eq("id", deletedId);
      if (error) throw error;
    }
  }

  w.MES_SHARED = Object.freeze({
    getMesConfig,
    isPrivateIpv4Host,
    normalizeUploadApiBase,
    createSupabaseClient,
    createBufferedJsonStorage,
    loadJsonList,
    applyStaticSeed,
    computeLatestCursor,
    fetchSupabaseRows,
    checkAuditAdminAccess,
    syncSupabaseChanges,
  });
})(window);
