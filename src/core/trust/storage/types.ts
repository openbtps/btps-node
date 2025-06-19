export interface TrustStoreOptions {
  connection: unknown; // could be file path, MongoClient, Sequelize, etc.
  entityName?: string; // e.g. 'trustedSenders', 'trust_rejections'
}
