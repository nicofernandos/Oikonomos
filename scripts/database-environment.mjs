import { userInfo } from 'node:os';

// libpq CLI tidak mengembangkan URI yang hanya diberikan lewat PGDATABASE.
// Pecah URI menjadi environment supaya kata sandi tidak muncul di argv proses.
export function databaseEnvironment(value) {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('URL database harus memakai protokol PostgreSQL');
  const environment = {
    ...process.env,
    PGHOST: url.hostname.replace(/^\[|\]$/g, '') || 'localhost',
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username) || userInfo().username,
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  };
  const parameters = {
    sslmode: 'PGSSLMODE', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY', sslrootcert: 'PGSSLROOTCERT',
    options: 'PGOPTIONS', application_name: 'PGAPPNAME', connect_timeout: 'PGCONNECT_TIMEOUT',
    host: 'PGHOST', port: 'PGPORT', user: 'PGUSER', password: 'PGPASSWORD', dbname: 'PGDATABASE',
  };
  for (const [key, setting] of url.searchParams) {
    if (!parameters[key]) throw new Error('Parameter URL database tidak didukung oleh utilitas backup');
    environment[parameters[key]] = setting;
  }
  return environment;
}
