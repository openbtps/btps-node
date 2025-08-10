#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting BTPS NestJS Application${NC}"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${YELLOW}❌ Docker is not running. Please start Docker and try again.${NC}"
    exit 1
fi

# Stop any existing containers
echo -e "${YELLOW}🛑 Stopping any existing containers...${NC}"
docker compose down

# Start MongoDB and Redis containers
echo -e "${YELLOW}🐳 Starting MongoDB and Redis containers...${NC}"
docker compose up -d

# Wait for containers to be ready
echo -e "${YELLOW}⏳ Waiting for containers to be ready...${NC}"
sleep 10

# Check if containers are running
if ! docker compose ps | grep -q "Up"; then
    echo -e "${YELLOW}❌ Failed to start containers. Please check the logs with 'docker compose logs'${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Containers are running!${NC}"

# Build the application
echo -e "${YELLOW}🔨 Building the application...${NC}"
yarn build

# Start the application
echo -e "${GREEN}🚀 Starting BTPS Server...${NC}"
yarn start
