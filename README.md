# **greendirect-api**

GreenDirect API server application powered by NestJS, TypeORM, Postgres, and Docker.

## Requirements

Make sure to have the following installed:

- `Node 10+ / NPM 6.1+` for application
- `docker` for postgres database
- `jest` for unit testing
- `tslint` for TypeScript linting (tslint in VSCode to automate linting)
- `prettier` for auto formatting in VSCode
- Make sure you setup an [npmjs.com](http://www.npmjs.com) account and request access to the `@sierralabs` private repos for the NPM dependencies.

## Installation

Using your npmjs.com account from above, run:

```bash
$ npm login
$ npm install
```

# Development Guide

## Dev Database Setup

Setup the Postgres database instance. When running the below command for the first time the `db/greendirect-schema.sql` will be applied.

Database Name: _greendirect_

```bash
# Rebuilds the database with a new Docker container.
$ npm run db

# Load initial mock data via tests.
$ npm run mocks
```

`db` runs migrations automatically.

## Run the app

```bash
# development
$ npm run start

# development: watch mode (restarts on changes)
$ npm run start:dev
```

For development, you can explore the API endpoints via Swagger:
http://localhost:3000/explorer/

```bash
# production mode (uses compiled JS)
$ npm run start:prod
```

# Testing Guide

## Test Database Setup

Creates a separate database instance for test. Database name: _greendirect-test_

```bash
# Rebuilds the test database with a new Docker container.
$ npm run test:db

# Load initial mock data
$ npm run test:mocks
```

`test:db` will automatically run migrations.

## Run automated tests

(requires the above database setup)

```bash
# unit tests
$ npm run test

# end-to-end tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Run local test server (manual test)

Requires: greendirect-test database, greendirect-web running at localhost:5050

```bash
npm run local-server
```

# Deployments

## Version bump

Use `npm version` command to set a git tag and update package.json with a new version number.

## Deploying to AWS Fargate ECS/ECR environment

Create a `deploy.[NODE_ENV].json` file in `config/` with the following information:

```json
{
  "deploy": {
    "projectName": "greendirect",
    "aws": {
      "accessKeyId": "",
      "secretAccessKey": "",
      "region": "us-west-2",
      "ecr": {
        "uri": "241940929212.dkr.ecr.us-west-2.amazonaws.com/greendirect-staging",
        "tag": "latest"
      },
      "ecs": {
        "service": "greendirect-staging-service",
        "cluster": "greendirect-staging-cluster"
      }
    },
    "npmToken": ""
  }
}
```

> NOTE: `npmToken` is for `@sierralabs/` NPM package installation on docker instance. You can create a NPM_TOKEN by following these instructions: https://docs.npmjs.com/getting-started/working_with_tokens (make sure you create a readonly token using `--read-only` flag.)

After creating the deploy config file you can execute the following replacing `NODE_ENV=staging` with the desired environment.

```bash
$ NODE_ENV=staging gulp deploy
```

# Database Migrations

IMPORTANT: Since migrations are possiby destructive operations, DO NOT run migrations scripts with automation. Do it manually so that any issues can be caught immediately.

## Creating Migrations

First, modify your entity classes with property changes. Second, follow the procedures below.

When naming migrations, include the operation and affected column/table.

```bash
$ npm run db:migrate:new -- "AlterOrderAddTypeColumn"
```

This will **automatically generate** your migration file with changes based on your entiy classes. The file will be placed in `db/migrations/[timestamp]_AlterOrderAddTypeColumn.ts` with both UP and DOWN sql scripts.

> NOTE: Auto generating the migration files guarantees that the entity definition matches the database schema exactly.

**YAH!** To run (add NODE_ENV to change environment):

```bash
$ npm run db # already includes run migrations
$ npm run db:migrate:up # executes all
$ npm run db:migrate:down # undoes the last migration, run again for each migration.
```

# Troubleshooting

## Clear persistent NPM packages

Delete you node_modules folder. Then:

```bash
$ npm install
$ npm cache verify
```

## Recreating Database Schema

When making changes to the database schema you can create a sql dump to replace `db/greendirect-schema.sql` by running:

```bash
docker exec -t greendirect-api_db_1 pg_dump -U root greendirect > db/greendirect-schema.sql
```

> Development: `greendirect-api_db_1` - is the name of the docker container on your machine (development).

> Test: `greendirect-api_db-test_1` - is the name of the docker container on your machine.

## Cleaning and resetting the Docker DB

If you want to reset the DB back to the emtpy schema you'll need to delete the docker container and the docker image.

Just re-run the npm scripts for database:

```bash
# for development
$ npm run db

# for test
$ npm run test:db
```

The script already automates the following commands:

```bash
# stops, removes volumes, and removes containers
$ docker-compose down -v --rmi local

# rebuilds and starts containers in background
$ docker-compose up --build -d
```

### Troubleshooting

```bash
# to start  with fresh docker build, remove all (both development and test):
$ docker-compose down -v --rmi all --remove-orphans
```
