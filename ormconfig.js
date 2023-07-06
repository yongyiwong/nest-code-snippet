const env = process.env.NODE_ENV || 'development';
const config = require(process.cwd() + `/config/config.${env}`);
const { PostgresNamingStrategy } = require('@sierralabs/nest-utils');

/**
 * Helper script used to load configuration of migrations with typeorm.
 * http://typeorm.io/#/using-ormconfig/loading-from-ormconfigjs
 * Grabs the current database connection settings from config/config.*.json
 */
const ormConfig = config.database; // connection settings
ormConfig.namingStrategy = new PostgresNamingStrategy();

// Source migrations (typeorm migration:create -n)
ormConfig.cli = { migrationsDir: 'db/migrations' };

// Transpiled migrations (target locations)
ormConfig.entities = [process.cwd() + '/dist/src/entities/*.entity.js'];
ormConfig.migrations = [process.cwd() + '/dist/db/migrations/*.js'];

module.exports = ormConfig;
