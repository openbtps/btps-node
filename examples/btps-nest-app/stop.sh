#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🛑 Stopping BTPS NestJS Application${NC}"

# Stop containers
echo -e "${YELLOW}🐳 Stopping MongoDB and Redis containers...${NC}"
docker compose down

echo -e "${GREEN}✅ Application stopped successfully!${NC}"
