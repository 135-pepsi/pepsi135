window.MES_CONFIG = {
  // Example: https://xxxx.supabase.co
  SUPABASE_URL: "https://your-project.supabase.co",
  // anon public key (do not use service_role here)
  SUPABASE_ANON_KEY: "your_anon_key",
  // Auto refresh interval (seconds)
  AUTO_REFRESH_SECONDS: 15,
  // Optional: Supabase storage bucket for attachments
  SUPABASE_STORAGE_BUCKET: "material-screenshots",
  // Optional: order page preview bucket (name/drawing click)
  SUPABASE_STORAGE_BUCKET_ORDER_ATTACHMENTS: "order-attachments",
  // Optional: order page file-button bucket (upload/download/delete)
  SUPABASE_STORAGE_BUCKET_TUZHI: "tuzhi",
  // Optional: signed URL expire seconds
  SUPABASE_STORAGE_SIGNED_EXPIRES: 3600,
  // Optional upload gateway, e.g. http://192.168.1.10:3001
  UPLOAD_API_BASE: "",
  // Max upload size (MB)
  UPLOAD_MAX_MB: 50,
  // Allowed extensions
  UPLOAD_ACCEPT: ".pdf,.jpg,.jpeg,.png,.dwg,.step,.zip,.rar",
};
