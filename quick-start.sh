#!/bin/bash

# Quick Start Script for eBook Platform
# This script helps you get the platform running quickly

set -e

echo "🚀 eBook Platform - Quick Start"
echo "================================"
echo ""

# Check prerequisites
echo "📋 Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi
echo "✅ Node.js $(node -v)"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed."
    exit 1
fi
echo "✅ npm $(npm -v)"

# Check PostgreSQL
if ! command -v psql &> /dev/null; then
    echo "⚠️  PostgreSQL is not installed. You'll need it to run the backend."
    echo "   Install with: brew install postgresql"
else
    echo "✅ PostgreSQL $(psql --version | awk '{print $3}')"
fi

echo ""
echo "📦 Dependencies already installed!"
echo ""

# Setup environment files
echo "⚙️  Setting up environment files..."

if [ ! -f "apps/backend/.env" ]; then
    echo "Creating backend .env file..."
    cp apps/backend/.env.example apps/backend/.env
    echo "✅ Created apps/backend/.env"
    echo "   Please edit this file to set your DATABASE_URL"
else
    echo "✅ Backend .env already exists"
fi

if [ ! -f "apps/web/.env.local" ]; then
    echo "Creating frontend .env.local file..."
    cp apps/web/.env.example apps/web/.env.local
    echo "✅ Created apps/web/.env.local"
else
    echo "✅ Frontend .env.local already exists"
fi

echo ""
echo "🗄️  Database Setup"
echo "=================="
echo ""
echo "To set up the database, run:"
echo "  1. createdb ebook_platform"
echo "  2. cd apps/backend && npm run migrate"
echo ""

echo "✅ Setup complete!"
echo ""
echo "🎯 Next Steps:"
echo "=============="
echo ""
echo "1. Configure your database:"
echo "   Edit apps/backend/.env and set DATABASE_URL"
echo ""
echo "2. Create and migrate database:"
echo "   createdb ebook_platform"
echo "   cd apps/backend && npm run migrate"
echo ""
echo "3. Start the development servers:"
echo "   npm run dev"
echo ""
echo "   Or start them separately:"
echo "   npm run backend  (http://localhost:3001)"
echo "   npm run web      (http://localhost:3000)"
echo ""
echo "4. Connect your Stacks wallet:"
echo "   Install Hiro or Leather wallet extension"
echo "   Visit http://localhost:3000"
echo ""
echo "📚 Documentation:"
echo "   README: ./README.md"
echo "   Walkthrough: See brain/walkthrough.md"
echo ""
echo "Happy reading! 📖"
