# iOS 26 Call Screening Detection

Intelligent handling of iOS 26 call screening using Twilio real-time transcription and pattern detection.

## Overview

This Twilio Serverless Function provides automatic detection and handling of all iOS 26 call screening scenarios. It uses real-time transcription to "listen" to the call and intelligently adapt its behavior based on what it detects - whether that's iOS 26's screening prompts, a human answering, or a voicemail greeting.

**Key Feature:** One function, one command, four scenarios handled automatically!

## Scenarios Handled

The function automatically detects and responds to four distinct scenarios:

1. **iOS 26 + Voicemail**: iOS 26 preamble → our identification → voicemail → leave message
2. **iOS 26 + Human**: iOS 26 preamble → our identification → human picks up → pass through call
3. **Direct Human Answer**: No call screening, human answers immediately → pass through call
4. **Direct Voicemail**: No call screening, goes to voicemail → leave message

## How It Works

**Detection Strategy:**
- **Real-time Transcription (Primary)**: Captures all speech patterns using Google's telephony-optimized speech recognition
- **AMD - Answering Machine Detection (Secondary)**: Runs in parallel, provides supplementary signals
- **Timing-based Logic**: Uses call duration to determine scenarios
- **Pattern Matching**: Distinguishes between iOS 26 prompts, voicemail greetings, and human speech

**State Machine:**
- `INITIAL` → Monitoring for iOS 26 or direct human/voicemail
- `IOS26_MONITORING` → iOS 26 detected, waiting for voicemail vs. human
- `PASSTHROUGH` → Human detected, transcription stopped, call connected
- `VOICEMAIL_DELIVERED` → Voicemail detected, message left

## Prerequisites

## Prerequisites

- **Twilio Account**: Active account with Phone Numbers capability
- **Node.js**: Version 18 or higher (for local development/deployment)
- **Twilio CLI**: For deploying and testing the function

## Setup Instructions

### 1. Install Twilio CLI

```bash
npm install -g twilio-cli
```

### 2. Authenticate with Twilio

```bash
twilio login
```

### 3. Install Serverless Toolkit

```bash
twilio plugins:install @twilio-labs/plugin-serverless
```

### 4. Deploy the Function

Navigate to the `iosCallScreeningTranscriptions` directory and deploy:

```bash
cd iosCallScreeningTranscriptions
twilio serverless:deploy
```

This will output a domain URL like `https://YOUR_DOMAIN.twil.io`

## Usage

### Testing the Function

Use this single command to test all scenarios (the function automatically adapts):

```bash
twilio api:core:calls:create \
  --from "+YOUR_TWILIO_NUMBER" \
  --to "+DESTINATION_NUMBER" \
  --url "https://YOUR_DOMAIN.twil.io/ios26-callScreeningDetection" \
  --async-amd true \
  --machine-detection-timeout 30 \
  --status-callback "https://YOUR_DOMAIN.twil.io/ios26-callScreeningDetection" \
  --status-callback-event "initiated ringing answered completed" \
  --status-callback-method "POST"
```

**Parameters Explained:**
- `--from`: Your Twilio phone number (must be in E.164 format: +1234567890)
- `--to`: Destination number to call (test with your own phones)
- `--url`: The webhook URL where your function is deployed
- `--async-amd`: Enables parallel answering machine detection
- `--machine-detection-timeout`: Gives AMD 30 seconds to analyze
- `--status-callback`: Receives webhooks at each call stage
- `--status-callback-event`: Get notified at initiated, ringing, answered, completed
- `--status-callback-method`: Use POST method for callbacks

### Quick Test Script

A helper script is included for easier testing. First, edit the configuration in `test-call.sh`:

```bash
# Edit these values at the top of test-call.sh
FROM_NUMBER="+1234567890"        # Your Twilio phone number
TO_NUMBER="+1987654321"          # Number to call (test with your own phones)
FUNCTION_URL="https://YOUR_DOMAIN.twil.io/ios26-callScreeningDetection"
```

Then run the script:

```bash
chmod +x test-call.sh
./test-call.sh
```

Or pass numbers as arguments (overrides the configured values):

```bash
./test-call.sh +YOUR_TWILIO_NUMBER +DESTINATION_NUMBER
```

The script includes all required parameters and helpful output showing what values are being used.

## How the Detection Works

### Pattern Recognition

The function uses sophisticated pattern matching to identify:

**iOS 26 Patterns:**
- "record your name and reason for calling"
- "if you record your name"
- "see if this person is available"
- And more variations...

**Voicemail Patterns:**
- "leave a message"
- "after the tone"
- "call has been forwarded"
- "not available"
- And 30+ other patterns...

**Human Speech Indicators:**
- Interactive greetings: "hello", "hey", "who is this"
- Questions with context: "what do you want", "who are you"
- Conversational responses: "hold on", "speaking", "wait"

### Timing Windows

- **0-5 seconds**: Initialization, starting transcription
- **5-35 seconds**: Early human detection window
- **After iOS 26 detection**: 90-second monitoring for voicemail vs. human
- **20+ seconds no iOS 26**: Likely direct human answer (Scenario 3)
- **25+ seconds in monitoring**: Fallback to voicemail detection

## Project Structure

```
iosCallScreeningTranscriptions/
├── README.md                          # This file
├── test-call.sh                       # Quick test helper script
├── package.json                       # Root dependencies
└── iosCallScreeningTranscriptions/
    ├── package.json                   # Twilio serverless dependencies
    └── functions/
        └── ios26_CallScreeningDetection_Transcriptions.js  # Main function (1876 lines)
```

## Key Features

✅ **Automatic Scenario Detection** - No configuration needed, handles all cases  
✅ **Real-time Transcription** - Google speech recognition with telephony optimization  
✅ **Pattern Matching** - 40+ voicemail patterns, iOS 26 detection, human speech recognition  
✅ **State Management** - Tracks call progression across multiple webhooks  
✅ **Race Condition Protection** - Uses Twilio's call metadata as mutex  
✅ **Comprehensive Logging** - Detailed webhook logging for debugging  
✅ **Well-Documented Code** - ~70% of function has beginner-friendly comments

## Technical Details

**Twilio Services Used:**
- Voice API with TwiML
- Real-time Transcription (Google engine, telephony model)
- Async AMD (Answering Machine Detection)
- REST API for call updates
- Status callbacks for webhook events

**Detection Approach:**
- Multi-layered detection (transcription + AMD + timing)
- Pattern matching on actual transcribed words
- Timing fallbacks ensure no call hangs indefinitely
- Action tracking prevents duplicate operations

**Race Condition Prevention:**
- 100ms delay before critical actions
- Uses Twilio's `call.dateUpdated` as distributed mutex
- Error handling for concurrent update attempts
- Status codes returned: 'SUCCESS', 'ABORTED', 'ERROR'

## Development

## Development

### Local Testing

1. **Install dependencies:**
   ```bash
   cd iosCallScreeningTranscriptions
   npm install
   ```

2. **Start local development server:**
   ```bash
   twilio serverless:start
   ```

3. **Use ngrok or similar to expose localhost:**
   ```bash
   ngrok http 3000
   ```

4. **Test with the ngrok URL** in your Twilio CLI command

### Viewing Logs

**Real-time logs during local development:**
```bash
twilio serverless:start --live-logs
```

**Production logs:**
```bash
twilio serverless:logs
```

Or view in Twilio Console: Functions → Services → Your Service → Logs

### Code Structure

The main function (`ios26_CallScreeningDetection_Transcriptions.js`) contains:

- **State Management**: Maps for tracking call state across webhooks
- **Webhook Handler**: Main `exports.handler` function processing all webhook types
- **Pattern Detection**: Functions for detecting iOS 26, voicemail, human speech
- **Action Functions**: REST API calls to update live calls
- **Comprehensive Comments**: ~70% of code has educational inline documentation

## Troubleshooting

### Common Issues

**Transcription not starting:**
- Ensure status callbacks are configured correctly
- Check that webhook URL matches your deployed domain
- Verify function is deployed (check Twilio Console)

**Missing iOS 26 detection:**
- Transcription might start after preamble completes
- Retroactive detection should catch "thanks, stay on the line"
- Check logs for transcription events

**Duplicate messages playing:**
- Fixed via race condition protection (100ms delay + dateUpdated check)
- If still occurring, check for multiple function instances

**False voicemail detection during human conversation:**
- State-based guards prevent this after PASSTHROUGH state
- Timing windows avoid premature voicemail detection

### Debug Logging

The function includes comprehensive logging. Check Twilio Function logs for:
- 🔔 Webhook received events
- 📋 Call status details
- 🤖 AMD results
- 📝 Transcription events
- 🔄 State transitions
- ✓ Action processing markers

## Performance 

**Response Times:**
- iOS 26 detection: 2-5 seconds from preamble start
- Human detection: 5-15 seconds typical
- Voicemail detection: 10-20 seconds typical
- Race condition delay: 100ms (imperceptible)

## Security Considerations

- Function runs in Twilio's secure serverless environment
- No credentials stored in code (use environment variables)
- Transcription data is transient (not persisted)
- Call logs available in Twilio Console for audit

## Future Enhancements

Possible improvements:
- [ ] Redis for distributed state management (production scale)
- [ ] Configurable messages via environment variables
- [ ] Multi-language support for iOS 26 detection
- [ ] Custom voicemail detection patterns
- [ ] Analytics dashboard for detection accuracy

## Contributing

Contributions welcome! Areas of interest:
- Additional pattern detection improvements
- Support for other languages/regions
- Performance optimizations
- Test coverage expansion

## License

This project is licensed under the MIT License.

## Acknowledgments

Built using:
- Twilio Voice API and Serverless Functions
- Google Cloud Speech-to-Text (telephony model)
- Real-time transcription webhooks
- TwiML for call control

---

**Questions?** Check the extensive inline documentation in `ios26_CallScreeningDetection_Transcriptions.js` - ~70% of the function is commented with beginner-friendly explanations!
