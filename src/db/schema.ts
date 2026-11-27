import {
  boolean,
  char,
  date,
  doublePrecision,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  depotName: text("depot_name")
    .notNull()
    .default("CEE Correios - Av. Diomicio de Freitas, 1899"),
  depotCep: char("depot_cep", { length: 8 }).notNull().default("88047401"),
  depotLat: doublePrecision("depot_lat").notNull().default(-27.664631239987585),
  depotLng: doublePrecision("depot_lng").notNull().default(-48.53156334735702),
  walkRadiusMeters: integer("walk_radius_meters").notNull().default(150),
  kmPerLiter: numeric("km_per_liter", { precision: 6, scale: 2 })
    .notNull()
    .default("10.00"),
  ratePerPackageBrl: numeric("rate_per_package_brl", { precision: 8, scale: 2 })
    .notNull()
    .default("2.11"),
  fuelPriceBrl: numeric("fuel_price_brl", { precision: 8, scale: 2 })
    .notNull()
    .default("6.00"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const cepCache = pgTable("cep_cache", {
  cep: char("cep", { length: 8 }).primaryKey(),
  logradouro: text("logradouro").notNull(),
  bairro: text("bairro"),
  localidade: text("localidade").notNull().default("Florianopolis"),
  uf: char("uf", { length: 2 }).notNull().default("SC"),
  source: text("source").notNull(), // 'viacep' | 'brasilapi'
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const addressCache = pgTable(
  "address_cache",
  {
    cep: char("cep", { length: 8 }).notNull(),
    numeroNorm: text("numero_norm").notNull(),
    logradouro: text("logradouro").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    placeId: text("place_id"),
    locationType: text("location_type"),
    isManualOverride: boolean("is_manual_override").notNull().default(false),
    cachedAt: timestamp("cached_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.cep, table.numeroNorm] })]
);

export const routes = pgTable("routes", {
  id: uuid("id").primaryKey().defaultRandom(),
  routeDate: date("route_date").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("em_andamento"),
  isStale: boolean("is_stale").notNull().default(false),
  depotLat: doublePrecision("depot_lat").notNull(),
  depotLng: doublePrecision("depot_lng").notNull(),
  walkRadiusMeters: integer("walk_radius_meters").notNull().default(150),
  kmPerLiter: numeric("km_per_liter", { precision: 6, scale: 2 })
    .notNull()
    .default("10.00"),
  ratePerPackageBrl: numeric("rate_per_package_brl", { precision: 8, scale: 2 })
    .notNull()
    .default("2.11"),
  fuelPriceBrl: numeric("fuel_price_brl", { precision: 8, scale: 2 })
    .notNull()
    .default("6.00"),
  ceeArrivalAt: timestamp("cee_arrival_at", { withTimezone: true }),
  departedAt: timestamp("departed_at", { withTimezone: true }),
  returnedAt: timestamp("returned_at", { withTimezone: true }),
  predictedKm: numeric("predicted_km", { precision: 8, scale: 2 }),
  actualKm: numeric("actual_km", { precision: 8, scale: 2 }),
  predictedDurationSec: integer("predicted_duration_sec"),
  polylineEncoded: text("polyline_encoded"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const routeStops = pgTable("route_stops", {
  id: uuid("id").primaryKey().defaultRandom(),
  routeId: uuid("route_id")
    .notNull()
    .references(() => routes.id, { onDelete: "cascade" }),
  stopType: text("stop_type").notNull(), // 'anchor' | 'adjacent'
  parentAnchorId: uuid("parent_anchor_id"),
  sequenceOrder: integer("sequence_order").notNull(),
  walkDistanceMeters: integer("walk_distance_meters"),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const routePackages = pgTable(
  "route_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    routeId: uuid("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    stopId: uuid("stop_id").references(() => routeStops.id, {
      onDelete: "set null",
    }),
    trackingCode: text("tracking_code").notNull(),
    cep: char("cep", { length: 8 }).notNull(),
    numeroRaw: text("numero_raw"),
    numeroNorm: text("numero_norm").notNull().default("SN"),
    logradouro: text("logradouro"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    isManualPin: boolean("is_manual_pin").notNull().default(false),
    isAr: boolean("is_ar").notNull().default(false),
    isDelivered: boolean("is_delivered").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    inAbsentList: boolean("in_absent_list").notNull().default(false),
    inInsufficientList: boolean("in_insufficient_list")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("route_packages_route_tracking_uidx").on(
      table.routeId,
      table.trackingCode
    ),
  ]
);

export const routeLogs = pgTable("route_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  routeId: uuid("route_id")
    .notNull()
    .references(() => routes.id, { onDelete: "cascade" }),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  message: text("message").notNull(),
});

export const routeJobs = pgTable("route_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  routeId: uuid("route_id")
    .notNull()
    .references(() => routes.id, { onDelete: "cascade" }),
  inngestRunId: text("inngest_run_id"),
  status: text("status").notNull().default("queued"),
  stage: text("stage").notNull().default("queued"),
  processedCount: integer("processed_count").notNull().default(0),
  totalCount: integer("total_count").notNull().default(0),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});
