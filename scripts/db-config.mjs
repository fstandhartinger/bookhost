// Pin the operator's private CA without disabling certificate verification.
export function databaseConfig() {
  const ca = process.env.DATABASE_SSL_CA_BASE64;
  return {
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 8000,
    query_timeout: 10000,
    ...(ca
      ? {
          ssl: {
            ca: Buffer.from(ca, "base64").toString("utf8"),
            rejectUnauthorized: true,
            ...(process.env.DATABASE_SSL_SERVERNAME
              ? { servername: process.env.DATABASE_SSL_SERVERNAME }
              : {}),
          },
        }
      : {}),
  };
}
