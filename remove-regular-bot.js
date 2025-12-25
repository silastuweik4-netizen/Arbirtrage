#!/bin/bash
#  remove-regular-bot.sh  — Remove ALL regular bot files

echo "🗑️ Removing ALL regular bot files..."
echo "✅ Keeping ONLY zero-capital flash loan system"

# Remove regular bot files
rm -f regular-bot.js
rm -f regular-main.js
rm -f regular-engine.js
rm -f regular-prices.js
rm -f regular-*.js

echo "✅ Regular bot files removed successfully!"
echo "✅ Zero-capital flash loan system is now the ONLY system!"
