#!/bin/bash

# ================================================================
# SMARTEXAMPRO DEPLOYMENT SCRIPT FOR GITHUB PAGES
# ================================================================
# This script builds the frontend and deploys it to GitHub Pages
# (imnothoan.github.io repository)
# ================================================================

set -e  # Exit on error

echo "========================================="
echo "SmartExamPro - GitHub Pages Deployment"
echo "========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
FRONTEND_DIR="Intelligence-Test"
DEPLOY_REPO_URL="https://github.com/imnothoan/imnothoan.github.io.git"
DEPLOY_BRANCH="main"
TEMP_DEPLOY_DIR="/tmp/smartexampro-deploy"

# Step 1: Check if we're in the right directory
if [ ! -d "$FRONTEND_DIR" ]; then
    echo -e "${RED}Error: Frontend directory '$FRONTEND_DIR' not found!${NC}"
    echo "Please run this script from the root of the AIforLife repository."
    exit 1
fi

echo -e "${GREEN}✓${NC} Found frontend directory"

# Step 2: Check if .env file exists
if [ ! -f "$FRONTEND_DIR/.env" ]; then
    echo -e "${YELLOW}Warning: .env file not found!${NC}"
    echo "Creating .env from .env.production..."
    cp "$FRONTEND_DIR/.env.production" "$FRONTEND_DIR/.env"
fi

echo -e "${GREEN}✓${NC} Environment configuration ready"

# Step 3: Install dependencies
echo ""
echo "Installing dependencies..."
cd "$FRONTEND_DIR"
npm install
echo -e "${GREEN}✓${NC} Dependencies installed"

# Step 4: Build the project
echo ""
echo "Building production bundle..."
npm run build
echo -e "${GREEN}✓${NC} Build completed"

# Step 5: Clone or update deployment repository
echo ""
echo "Preparing deployment repository..."
if [ -d "$TEMP_DEPLOY_DIR" ]; then
    echo "Removing old deployment directory..."
    rm -rf "$TEMP_DEPLOY_DIR"
fi

echo "Cloning deployment repository..."
git clone "$DEPLOY_REPO_URL" "$TEMP_DEPLOY_DIR"
cd "$TEMP_DEPLOY_DIR"

# Make sure we're on the right branch
git checkout "$DEPLOY_BRANCH" || git checkout -b "$DEPLOY_BRANCH"

echo -e "${GREEN}✓${NC} Deployment repository ready"

# Step 6: Copy build files
echo ""
echo "Copying build files..."
cd "$TEMP_DEPLOY_DIR"

// Remove old files (keep CNAME, README.md, .git)
find . -maxdepth 1 ! -name 'CNAME' ! -name 'README.md' ! -name '.git' ! -name '.' ! -name '..' -exec rm -rf {} + 2>/dev/null || true

# Copy new build files
cp -r "$OLDPWD/../dist/"* .

echo -e "${GREEN}✓${NC} Build files copied"

# Step 7: Commit and push
echo ""
echo "Committing changes..."
git add .

if git diff --staged --quiet; then
    echo -e "${YELLOW}No changes to deploy${NC}"
    echo "The deployed version is already up to date."
else
    COMMIT_MSG="Deploy: $(date '+%Y-%m-%d %H:%M:%S') - Fix infinite redirect loop and improve auth"
    git commit -m "$COMMIT_MSG"
    
    echo ""
    echo "Pushing to GitHub Pages..."
    git push origin "$DEPLOY_BRANCH"
    
    echo ""
    echo -e "${GREEN}=========================================${NC}"
    echo -e "${GREEN}✓ DEPLOYMENT SUCCESSFUL!${NC}"
    echo -e "${GREEN}=========================================${NC}"
    echo ""
    echo "Your site will be available at:"
    echo -e "${GREEN}https://smartexampro.me${NC}"
    echo ""
    echo "Note: It may take a few minutes for GitHub Pages to update."
    echo "Clear your browser cache if you don't see changes immediately."
fi

# Cleanup
echo ""
echo "Cleaning up..."
cd -
rm -rf "$TEMP_DEPLOY_DIR"

echo ""
echo -e "${GREEN}Done!${NC}"
