#!/bin/bash
# ABOUTME: Helper script to test iOS 26 call screening detection
# ABOUTME: This single command works for all 4 scenarios - the function handles the intelligence

# Configuration - REPLACE THESE WITH YOUR VALUES
FROM_NUMBER="+1234567890"        # Your Twilio phone number
TO_NUMBER="+1987654321"          # Number to call (test with your own phones)
FUNCTION_URL="https://YOUR_DOMAIN.twil.io/ios26-callScreeningDetection"

# Allow overriding numbers from command line
if [ -n "$1" ]; then
  FROM_NUMBER="$1"
fi

if [ -n "$2" ]; then
  TO_NUMBER="$2"
fi

# ONE COMMAND FOR ALL SCENARIOS
# This same command works for all 4 scenarios:
# 1. iOS 26 + Voicemail
# 2. iOS 26 + Human answers
# 3. No iOS 26 + Human answers
# 4. No iOS 26 + Voicemail
#
# The function's intelligence automatically detects which scenario is occurring
# and responds appropriately. No need for different commands or configurations!
#
# IMPORTANT: All parameters below are REQUIRED for proper operation:
# - machine-detection "Enable" + async-amd true = background AMD
# - async-amd-status-callback = where AMD sends results
# - status-callback = where call status events are sent
# Without these, the function may exhibit duplicate message playback!

echo "📞 Making test call..."
echo "   From: $FROM_NUMBER"
echo "   To: $TO_NUMBER"
echo "   Function: $FUNCTION_URL"
echo ""

twilio api:core:calls:create \
  --from "$FROM_NUMBER" \
  --to "$TO_NUMBER" \
  --url "$FUNCTION_URL" \
  --machine-detection "Enable" \
  --async-amd true \
  --async-amd-status-callback "$FUNCTION_URL" \
  --async-amd-status-callback-method "POST" \
  --machine-detection-timeout 30 \
  --status-callback "$FUNCTION_URL" \
  --status-callback-event "initiated" "ringing" "answered" "in-progress" "completed" \
  --status-callback-method "POST"
