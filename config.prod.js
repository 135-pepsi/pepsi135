// Production defaults (safe to commit). Real values should come from config.runtime.js.
(function (w) {
  var defaults = {
    SUPABASE_URL: "",
    SUPABASE_ANON_KEY: "",
    AUTO_REFRESH_SECONDS: 5,
    SUPABASE_STORAGE_BUCKET: "material-screenshots",
    SUPABASE_STORAGE_SIGNED_EXPIRES: 3600,
    UPLOAD_API_BASE: "",
    UPLOAD_MAX_MB: 50,
    UPLOAD_ACCEPT: ".pdf,.jpg,.jpeg,.png,.dwg,.step,.zip,.rar",
  };
  var baseConfig = w.MES_CONFIG && typeof w.MES_CONFIG === "object" ? w.MES_CONFIG : {};
  var injectedConfig = w.__MES_CONFIG__ && typeof w.__MES_CONFIG__ === "object" ? w.__MES_CONFIG__ : {};
  w.MES_CONFIG = Object.assign({}, defaults, baseConfig, injectedConfig);
})(window);
