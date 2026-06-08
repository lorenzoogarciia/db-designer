export type DataType = string;

export interface DataTypeOption {
  value: DataType;
  label: string;
  group: string;
}

export const DATA_TYPE_OPTIONS: DataTypeOption[] = [
  { value: "id", label: "id (autoincremental)", group: "Especiales" },
  { value: "uuid", label: "uuid", group: "Especiales" },
  { value: "enum", label: "enum", group: "Especiales" },
  { value: "serial", label: "serial (PostgreSQL)", group: "Enteros" },
  { value: "bigserial", label: "bigserial (PostgreSQL)", group: "Enteros" },
  { value: "smallint", label: "smallint", group: "Enteros" },
  { value: "integer", label: "integer / int", group: "Enteros" },
  { value: "bigint", label: "bigint", group: "Enteros" },
  { value: "tinyint", label: "tinyint (MySQL)", group: "Enteros" },
  { value: "mediumint", label: "mediumint (MySQL)", group: "Enteros" },
  { value: "decimal", label: "decimal", group: "Decimales" },
  { value: "numeric", label: "numeric", group: "Decimales" },
  { value: "float", label: "float", group: "Decimales" },
  { value: "double", label: "double", group: "Decimales" },
  { value: "real", label: "real", group: "Decimales" },
  { value: "char", label: "char", group: "Texto" },
  { value: "varchar", label: "varchar", group: "Texto" },
  { value: "text", label: "text", group: "Texto" },
  { value: "tinytext", label: "tinytext (MySQL)", group: "Texto" },
  { value: "mediumtext", label: "mediumtext (MySQL)", group: "Texto" },
  { value: "longtext", label: "longtext (MySQL)", group: "Texto" },
  { value: "boolean", label: "boolean", group: "Logico" },
  { value: "bit", label: "bit", group: "Logico" },
  { value: "date", label: "date", group: "Fecha y hora" },
  { value: "time", label: "time", group: "Fecha y hora" },
  { value: "datetime", label: "datetime (MySQL)", group: "Fecha y hora" },
  { value: "timestamp", label: "timestamp", group: "Fecha y hora" },
  { value: "timestamptz", label: "timestamptz (PostgreSQL)", group: "Fecha y hora" },
  { value: "year", label: "year (MySQL)", group: "Fecha y hora" },
  { value: "interval", label: "interval (PostgreSQL)", group: "Fecha y hora" },
  { value: "json", label: "json", group: "JSON" },
  { value: "jsonb", label: "jsonb (PostgreSQL)", group: "JSON" },
  { value: "binary", label: "binary", group: "Binario" },
  { value: "varbinary", label: "varbinary", group: "Binario" },
  { value: "blob", label: "blob (MySQL)", group: "Binario" },
  { value: "tinyblob", label: "tinyblob (MySQL)", group: "Binario" },
  { value: "mediumblob", label: "mediumblob (MySQL)", group: "Binario" },
  { value: "longblob", label: "longblob (MySQL)", group: "Binario" },
  { value: "bytea", label: "bytea (PostgreSQL)", group: "Binario" },
  { value: "inet", label: "inet (PostgreSQL)", group: "Red" },
  { value: "cidr", label: "cidr (PostgreSQL)", group: "Red" },
  { value: "macaddr", label: "macaddr (PostgreSQL)", group: "Red" },
  { value: "money", label: "money (PostgreSQL)", group: "Otros" },
  { value: "xml", label: "xml", group: "Otros" },
  { value: "geometry", label: "geometry (MySQL)", group: "Otros" },
  { value: "point", label: "point (PostgreSQL)", group: "Otros" },
];

export type SqlDialect = "mysql" | "postgresql" | "sqlserver";

const MYSQL_TYPE_MAP: Record<string, string> = {
  id: "INT AUTO_INCREMENT",
  uuid: "CHAR(36)",
  serial: "INT AUTO_INCREMENT",
  bigserial: "BIGINT AUTO_INCREMENT",
  smallint: "SMALLINT",
  integer: "INT",
  bigint: "BIGINT",
  tinyint: "TINYINT",
  mediumint: "MEDIUMINT",
  decimal: "DECIMAL(10,2)",
  numeric: "DECIMAL(10,2)",
  float: "FLOAT",
  double: "DOUBLE",
  real: "FLOAT",
  char: "CHAR(64)",
  varchar: "VARCHAR(255)",
  text: "TEXT",
  tinytext: "TINYTEXT",
  mediumtext: "MEDIUMTEXT",
  longtext: "LONGTEXT",
  boolean: "TINYINT(1)",
  bit: "BIT(1)",
  date: "DATE",
  time: "TIME",
  datetime: "DATETIME",
  timestamp: "TIMESTAMP",
  timestamptz: "TIMESTAMP",
  year: "YEAR",
  interval: "VARCHAR(64)",
  json: "JSON",
  jsonb: "JSON",
  binary: "BINARY(16)",
  varbinary: "VARBINARY(255)",
  blob: "BLOB",
  tinyblob: "TINYBLOB",
  mediumblob: "MEDIUMBLOB",
  longblob: "LONGBLOB",
  bytea: "BLOB",
  inet: "VARCHAR(45)",
  cidr: "VARCHAR(43)",
  macaddr: "CHAR(17)",
  money: "DECIMAL(19,4)",
  xml: "LONGTEXT",
  geometry: "GEOMETRY",
  point: "POINT",
  enum: "ENUM('')",
};

const POSTGRESQL_TYPE_MAP: Record<string, string> = {
  id: "SERIAL",
  uuid: "UUID",
  serial: "SERIAL",
  bigserial: "BIGSERIAL",
  smallint: "SMALLINT",
  integer: "INTEGER",
  bigint: "BIGINT",
  tinyint: "SMALLINT",
  mediumint: "INTEGER",
  decimal: "DECIMAL(10,2)",
  numeric: "NUMERIC(10,2)",
  float: "REAL",
  double: "DOUBLE PRECISION",
  real: "REAL",
  char: "CHAR(64)",
  varchar: "VARCHAR(255)",
  text: "TEXT",
  tinytext: "TEXT",
  mediumtext: "TEXT",
  longtext: "TEXT",
  boolean: "BOOLEAN",
  bit: "BIT(1)",
  date: "DATE",
  time: "TIME",
  datetime: "TIMESTAMP",
  timestamp: "TIMESTAMP",
  timestamptz: "TIMESTAMPTZ",
  year: "SMALLINT",
  interval: "INTERVAL",
  json: "JSON",
  jsonb: "JSONB",
  binary: "BYTEA",
  varbinary: "BYTEA",
  blob: "BYTEA",
  tinyblob: "BYTEA",
  mediumblob: "BYTEA",
  longblob: "BYTEA",
  bytea: "BYTEA",
  inet: "INET",
  cidr: "CIDR",
  macaddr: "MACADDR",
  money: "MONEY",
  xml: "XML",
  geometry: "GEOMETRY",
  point: "POINT",
  enum: "TEXT /* enum */",
};

const SQLSERVER_TYPE_MAP: Record<string, string> = {
  id: "INT IDENTITY(1,1)",
  uuid: "UNIQUEIDENTIFIER",
  serial: "INT IDENTITY(1,1)",
  bigserial: "BIGINT IDENTITY(1,1)",
  smallint: "SMALLINT",
  integer: "INT",
  bigint: "BIGINT",
  tinyint: "TINYINT",
  mediumint: "INT",
  decimal: "DECIMAL(10,2)",
  numeric: "NUMERIC(10,2)",
  float: "REAL",
  double: "FLOAT(53)",
  real: "REAL",
  char: "CHAR(64)",
  varchar: "NVARCHAR(255)",
  text: "NVARCHAR(MAX)",
  tinytext: "NVARCHAR(255)",
  mediumtext: "NVARCHAR(MAX)",
  longtext: "NVARCHAR(MAX)",
  boolean: "BIT",
  bit: "BIT",
  date: "DATE",
  time: "TIME",
  datetime: "DATETIME2",
  timestamp: "DATETIME2",
  timestamptz: "DATETIMEOFFSET",
  year: "SMALLINT",
  interval: "NVARCHAR(64)",
  json: "NVARCHAR(MAX)",
  jsonb: "NVARCHAR(MAX)",
  binary: "BINARY(16)",
  varbinary: "VARBINARY(255)",
  blob: "VARBINARY(MAX)",
  tinyblob: "VARBINARY(255)",
  mediumblob: "VARBINARY(MAX)",
  longblob: "VARBINARY(MAX)",
  bytea: "VARBINARY(MAX)",
  inet: "NVARCHAR(45)",
  cidr: "NVARCHAR(43)",
  macaddr: "CHAR(17)",
  money: "MONEY",
  xml: "XML",
  geometry: "GEOMETRY",
  point: "GEOMETRY",
  enum: "NVARCHAR(50) /* enum */",
};

export function mapDataTypeToSql(type: DataType, dialect: SqlDialect): string {
  const maps = {
    mysql: MYSQL_TYPE_MAP,
    postgresql: POSTGRESQL_TYPE_MAP,
    sqlserver: SQLSERVER_TYPE_MAP,
  };
  return maps[dialect][type] ?? maps[dialect].text;
}

export function isAutoIncrementType(type: DataType): boolean {
  return type === "id" || type === "serial" || type === "bigserial";
}

export function isIntegerLikeType(type: DataType): boolean {
  return ["id", "serial", "bigserial", "smallint", "integer", "bigint", "tinyint", "mediumint"].includes(type);
}

export function normalizeDataType(raw: unknown): DataType {
  const value = typeof raw === "string" ? raw.trim() : "text";
  if (DATA_TYPE_OPTIONS.some((option) => option.value === value)) return value;
  const legacyMap: Record<string, DataType> = {
    int: "integer",
    string: "text",
    bool: "boolean",
  };
  return legacyMap[value] ?? "text";
}

export function dataTypeLabel(type: DataType): string {
  return DATA_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}
