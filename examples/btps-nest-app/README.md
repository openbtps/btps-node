# BTPS NestJS Application

A NestJS application that integrates the BTPS Server with MongoDB and Redis support.

## Prerequisites

- Node.js 20+ with ES module support
- Docker and Docker Compose (for MongoDB and Redis)
- BTPS server identity keys (public/private key pair)

## Setup

1. **Install dependencies:**

   `@btps/sdk` is linked from this repository with `"@btps/sdk": "portal:../.."`
   in `package.json`. There is no tarball to add. The SDK's `main` points at
   `dist/`, so build the SDK at the repository root first:

   ```bash
   # from the repository root
   yarn install
   yarn build

   # then in this example
   cd examples/btps-nest-app
   yarn install
   ```

   Do not run `yarn add ./package.tgz`. It replaces the portal link with a
   tarball that is not committed, and a fresh clone can no longer install.

   If you change the SDK's own dependencies (root `package.json`), run
   `yarn install` in this directory as well, and commit the updated
   `examples/btps-nest-app/yarn.lock`. If you don't, CI's
   `yarn install --immutable` for this example fails.

2. **Generate BTPS server keys:**

   ```bash
   mkdir keys
   # Generate your server identity keys and place them in the keys/ directory
   # - keys/server-public.pem
   # - keys/server-private.pem
   ```

3. **Configure environment:**

   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

4. **Start the application with Docker:**

   ```bash
   # Start MongoDB and Redis containers, then the application
   yarn start:docker

   # Or start containers separately
   yarn docker:up
   yarn start:dev
   ```

## Docker Setup

This application uses Docker Compose to run MongoDB and Redis containers.

> **Known limitation:** the `btps-server` image does not build at the moment.
> `Dockerfile` still copies `package.tgz`, and its build context is this
> directory, so `portal:../..` cannot reach the SDK. `docker compose up`
> (and so `yarn start:docker` and `yarn docker:up`) fails while building
> that image. Until the Dockerfile is updated, run the app with
> `yarn start:dev` and start MongoDB and Redis on their own with
> `docker compose up -d mongodb redis`.

### Quick Start

```bash
# Start everything (containers + application)
yarn start:docker

# Stop everything
yarn stop:docker
```

### Manual Docker Management

```bash
# Start containers only
yarn docker:up

# Stop containers
yarn docker:down

# View container logs
yarn docker:logs
```

### Container Details

- **MongoDB**:
  - Port: 27017
  - Database: btps
  - Username: admin
  - Password: password
  - Connection: `mongodb://admin:password@localhost:27017/btps?authSource=admin`

- **Redis**:
  - Port: 6379
  - No authentication required
  - Connection: `redis://localhost:6379`

## Features

- BTPS Server integration with TLS support
- MongoDB trust store and identity store
- Redis token store for authentication
- Comprehensive logging and monitoring

## Development

```bash
# Start development server (requires containers to be running)
yarn start:dev

# Run tests
yarn test

# Build for production
yarn build
```

## Troubleshooting

### Container Issues

If containers fail to start:

```bash
# Check container status
docker-compose ps

# View logs
docker-compose logs

# Restart containers
docker-compose down
docker-compose up -d
```

### Connection Issues

Make sure the containers are running and accessible:

```bash
# Test MongoDB connection
docker exec -it btps-mongodb mongosh --username admin --password password --authenticationDatabase admin

# Test Redis connection
docker exec -it btps-redis redis-cli ping
```
