// ABOUTME: iOS 26 call screening detection - FULL implementation with all 4 scenarios
// ABOUTME: Handles: 1) No human, 2) Human after preamble, 3) No screening + human, 4) No screening + voicemail

/*
 * ============================================================================
 * iOS 26 CALL SCREENING DETECTION - COMPLETE IMPLEMENTATION
 * ============================================================================
 * 
 * PURPOSE:
 * This Twilio Serverless Function provides intelligent detection and handling
 * of all iOS 26 call screening scenarios. It uses real-time transcription to
 * "listen" to the call and automatically adapt its behavior based on what it
 * detects - whether that's iOS 26's screening prompts, a human answering,
 * or a voicemail greeting.
 * 
 * KEY INSIGHT:
 * The same function handles ALL scenarios without any configuration changes.
 * The intelligence is in the pattern detection and state management, not in
 * how you initiate the call. One command, four scenarios!
 * 
 * DEPENDENCIES:
 * - Twilio Node.js SDK: Provides TwiML generation and API client
 * - VoiceResponse: Builder for creating TwiML (XML instructions for calls)
 */

const Twilio = require('twilio');
const VoiceResponse = Twilio.twiml.VoiceResponse;

/**
 * Enhanced iOS 26 Call Screening Detection - ALL SCENARIOS
 * 
 * SCENARIOS HANDLED:
 * 1. No Human Interaction: iOS 26 preamble → our response → voicemail → leave message
 * 2. Human After Preamble: iOS 26 preamble → our response → HUMAN PICKS UP → stop transcription, pass through
 * 3. No Call Screening + Human: Human answers directly (no iOS 26) → pass through immediately
 * 4. No Call Screening + Voicemail: Voicemail without iOS 26 → leave message directly
 * 
 * DETECTION STRATEGY:
 * - Real-time Transcription (PRIMARY): Captures all speech patterns
 * - AMD (SECONDARY): Runs in parallel, provides supplementary signals
 * - Timing-based: Use call duration to determine scenarios
 * - Pattern matching: Distinguish iOS 26, voicemail, and human speech
 * 
 * USAGE - ONE COMPLETE COMMAND FOR ALL SCENARIOS:
 * This function handles all 4 scenarios automatically. Use this single command to test:
 * 
 *   twilio api:core:calls:create \
 *     --from "+YOUR_NUMBER" \
 *     --to "+DESTINATION" \
 *     --url "https://YOUR_DOMAIN.twil.io/ios26_CallScreeningDetection_Transcriptions" \
 *     --async-amd true \
 *     --machine-detection-timeout 30 \
 *     --status-callback "https://YOUR_DOMAIN.twil.io/ios26_CallScreeningDetection_Transcriptions" \
 *     --status-callback-event "initiated ringing answered completed" \
 *     --status-callback-method "POST"
 * 
 * The same command works for ALL scenarios - the function's intelligence automatically
 * detects which scenario is occurring and responds appropriately.
 * 
 * WHY THESE PARAMETERS ARE NEEDED:
 * - status-callback: Allows function to receive webhooks BEFORE call connects
 * - status-callback-event: Ensures we get notified at each call stage
 * - async-amd: Enables parallel answering machine detection
 * - machine-detection-timeout: Gives AMD enough time to analyze the call
 * 
 * These parameters enable the function to start transcription early enough to capture
 * iOS 26's initial preamble and properly sequence all detection logic.
 * 
 * @param {Object} context - Twilio Runtime context with environment variables
 * @param {Object} event - Webhook event data from Twilio
 * @param {Function} callback - Twilio callback function
 */
exports.handler = async function(context, event, callback) {
  // ============================================================================
  // COMPREHENSIVE WEBHOOK LOGGING
  // ============================================================================
  
  const callSid = event.CallSid;
  const timestamp = new Date().toISOString();
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`🔔 WEBHOOK RECEIVED at ${timestamp}`);
  console.log(`📞 Call SID: ${callSid}`);
  console.log('───────────────────────────────────────────────────────────────');
  
  // Log all event properties in organized sections
  console.log('📋 CALL STATUS PROPERTIES:');
  console.log(`   CallStatus: ${event.CallStatus || 'N/A'}`);
  console.log(`   CallDuration: ${event.CallDuration || 'N/A'}`);
  console.log(`   Direction: ${event.Direction || 'N/A'}`);
  console.log(`   From: ${event.From || 'N/A'}`);
  console.log(`   To: ${event.To || 'N/A'}`);
  
  console.log('🤖 AMD PROPERTIES:');
  console.log(`   AnsweredBy: ${event.AnsweredBy || 'N/A'}`);
  console.log(`   MachineDetectionDuration: ${event.MachineDetectionDuration || 'N/A'}`);
  
  console.log('📝 TRANSCRIPTION PROPERTIES:');
  console.log(`   TranscriptionEvent: ${event.TranscriptionEvent || 'N/A'}`);
  console.log(`   TranscriptionSid: ${event.TranscriptionSid || 'N/A'}`);
  console.log(`   TranscriptionTrack: ${event.TranscriptionTrack || 'N/A'}`);
  console.log(`   TranscriptionStatus: ${event.TranscriptionStatus || 'N/A'}`);
  console.log(`   TranscriptionData: ${event.TranscriptionData || 'N/A'}`);
  
  console.log('🔧 OTHER PROPERTIES:');
  Object.keys(event).forEach(key => {
    if (!['CallSid', 'CallStatus', 'CallDuration', 'Direction', 'From', 'To', 
          'AnsweredBy', 'MachineDetectionDuration',
          'TranscriptionEvent', 'TranscriptionSid', 'TranscriptionTrack', 
          'TranscriptionStatus', 'TranscriptionData'].includes(key)) {
      console.log(`   ${key}: ${event[key]}`);
    }
  });
  console.log('═══════════════════════════════════════════════════════════════');
  
  const response = new VoiceResponse();
  
  try {
    // ============================================================================
    // EXTRACT WEBHOOK DATA - WHAT TYPE OF WEBHOOK IS THIS?
    // ============================================================================
    /*
     * Twilio sends MULTIPLE types of webhooks to this function:
     * 1. Status callbacks (CallStatus): initiated, ringing, answered, completed
     * 2. AMD callbacks (AnsweredBy): machine_start, machine_end_beep, human, fax, unknown
     * 3. Transcription events (TranscriptionEvent): transcription-started, transcription-content, transcription-stopped
     * 
     * Each webhook type provides different information. We need to handle all of them!
     */
    
    const callStatus = event.CallStatus;              // Status of the call lifecycle
    const amdResult = event.AnsweredBy;               // Result from Answering Machine Detection
    const transcriptionEvent = event.TranscriptionEvent;  // Type of transcription webhook
    const transcriptionData = event.TranscriptionData;    // Actual transcript text (JSON string)
    const transcriptionSid = event.TranscriptionSid;      // Unique ID for this transcription session
    
    // ============================================================================
    // LOAD CONFIGURATION - MESSAGES WE'LL SPEAK OR LEAVE
    // ============================================================================
    /*
     * These messages can be customized via environment variables in Twilio Functions.
     * We provide sensible defaults for testing, but production apps should customize these.
     */
    
    // Message to play after detecting iOS 26 preamble (our "identification")
    const screeningResponse = context.SCREENING_RESPONSE || 
      "This is Twilio calling to test iOS 26 call screening detection, I will leave a voicemail if you don't answer";
    
    // Message to leave on voicemail (both after iOS 26 and direct voicemail scenarios)
    const voicemailMessage = context.VOICEMAIL_MESSAGE || 
      "This is Twilio leaving a voicemail";
    
    // The iOS 26 phrase we're listening for (the main preamble that triggers screening)
    const primaryPhrase = context.IOS26_PRIMARY_PHRASE || 
      "Hi, if you record your name and reason for calling, I'll see if this person is available";
    
    console.log(`Processing call ${callSid} with status: ${callStatus}`);
    
    // ============================================================================
    // SHORT-CIRCUIT FOR ALREADY PROCESSED CALLS
    // ============================================================================
    /*
     * OPTIMIZATION: If we've already fully processed this call (left voicemail or
     * connected human), we can ignore subsequent webhooks. This prevents wasted
     * processing and potential duplicate actions.
     * 
     * WHY THIS MATTERS:
     * - Twilio continues sending transcription webhooks even after we Stop transcription
     * - Status callbacks continue arriving (e.g., 'completed' status)
     * - We don't want to re-process calls that are already "done"
     */
    
    if (!event.TranscriptionEvent && callSid) {
      const state = getCallState(callSid);
      
      // Terminal states - call is fully processed, nothing more to do
      if (state === 'PASSTHROUGH' || state === 'VOICEMAIL_DELIVERED') {
        console.log(`🛑 Call ${callSid} already in ${state} state. Short-circuiting.`);
        const emptyResponse = new VoiceResponse();
        return callback(null, emptyResponse);
      }
    }
    
    // ============================================================================
    // ASYNC AMD CALLBACK PROCESSING (RUNS IN PARALLEL WITH TRANSCRIPTION)
    // ============================================================================
    /*
     * AMD (Answering Machine Detection) runs in PARALLEL with our transcription.
     * It's a separate analysis that happens simultaneously. Results arrive as
     * separate webhooks with the AnsweredBy parameter.
     * 
     * IMPORTANT DESIGN DECISION:
     * We use AMD as a SECONDARY signal, not primary. Why?
     * - AMD can't distinguish iOS 26 from regular voicemail (both are "machine")
     * - AMD can't detect human speech AFTER iOS 26 prompt
     * - Transcription gives us actual words, allowing pattern matching
     * 
     * AMD is useful for:
     * - Confirmation/validation of transcription findings
     * - Backup signal if transcription is delayed
     * - Quick human detection in some scenarios
     */
    
    // When using AsyncAmd=true, AMD results come to AsyncAmdStatusCallback URL
    // They arrive as separate webhooks with AnsweredBy parameter
    // This is completely independent from the main call flow and transcription
    
    if (amdResult) {
      console.log(`🔍 [AsyncAMD] Result: ${amdResult} for call ${callSid}`);
      
      // Store AMD result for correlation with transcription data
      // Our transcription logic can reference this as a supplementary signal
      setAMDResult(callSid, amdResult);
      
      const currentState = getCallState(callSid);
      const elapsedTime = getCallElapsedTime(callSid);
      
      console.log(`[AsyncAMD] State: ${currentState}, Elapsed: ${elapsedTime.toFixed(1)}s, Result: ${amdResult}`);
      
      // AMD provides a supplementary signal that can work WITH transcription
      // We use it to supplement detection, not replace transcription
      
      if (amdResult === 'machine_start' || amdResult === 'machine_end_beep') {
        console.log(`[AsyncAMD] 📞 Machine detected - storing for correlation with transcription`);
        
        // CRITICAL: Don't take action here! AMD can't distinguish between:
        // - iOS 26 call screening (machine_start)
        // - Regular voicemail greeting (machine_start)
        // Only transcription with pattern matching can tell these apart!
        
      } else if (amdResult === 'human') {
        console.log(`[AsyncAMD] 👤 Human detected - storing for correlation with transcription`);
        
        // Human detection from AMD is useful confirmation, but we still need
        // transcription to determine:
        // - Is this human AFTER iOS 26 prompt? (Scenario 2)
        // - Is this human answering directly? (Scenario 3)
        // Pattern matching on transcribed speech gives us this distinction!
        
      } else if (amdResult === 'fax') {
        console.log(`[AsyncAMD] 📠 Fax detected - call will be handled accordingly`);
      } else if (amdResult === 'unknown') {
        console.log(`[AsyncAMD] ❓ Unknown - AMD could not determine, transcription will handle`);
      }
      
      // IMPORTANT: Return empty TwiML for AsyncAmd status callbacks
      // These are separate webhooks that don't control call flow
      const emptyResponse = new VoiceResponse();
      return callback(null, emptyResponse);
    }
    
    // ============================================================================
    // REAL-TIME TRANSCRIPTION WEBHOOK PROCESSING
    // ============================================================================
    
    if (transcriptionEvent === 'transcription-content' && transcriptionData) {
      console.log('╔═══════════════════════════════════════════════════════════════╗');
      console.log('║        TRANSCRIPTION CONTENT WEBHOOK RECEIVED                 ║');
      console.log('╚═══════════════════════════════════════════════════════════════╝');
      console.log(`📝 Call: ${callSid}`);
      console.log(`📝 TranscriptionSid: ${transcriptionSid}`);
      
      // Initialize state if not already done (transcription webhooks don't have CallStatus)
      if (!callStates.has(callSid)) {
        console.log(`⚠️  LATE INITIALIZATION for call ${callSid} (via transcription webhook)`);
        initializeCallState(callSid);
      }
      
      const currentState = getCallState(callSid);
      const elapsedTime = getCallElapsedTime(callSid);
      console.log(`📊 Current State: ${currentState}, Elapsed: ${elapsedTime.toFixed(1)}s`);
      
      try {
        const parsedData = JSON.parse(transcriptionData);
        const transcript = parsedData.transcript || parsedData.Transcript;
        const confidence = parsedData.confidence || parsedData.Confidence;
        const isFinal = event.Final === 'true' || parsedData.is_final;
        
        console.log('─────────────────────────────────────────────────────────────');
        console.log(`💬 TRANSCRIPT: "${transcript}"`);
        console.log(`📊 Confidence: ${confidence}, Final: ${isFinal}`);
        console.log('─────────────────────────────────────────────────────────────');
        
        if (transcript && transcript.trim()) {
          console.log(`🔄 Calling processTranscriptionWithScenarios...`);

          try {
            const detectionResult = await processTranscriptionWithScenarios(
              transcript, 
              isFinal, 
              callSid, 
              context, 
              screeningResponse, 
              voicemailMessage, 
              primaryPhrase
            );
            
            console.log(`✅ Detection Result:`, JSON.stringify(detectionResult, null, 2));
            
            if (detectionResult && detectionResult.detected) {
              console.log(`🎯 ${detectionResult.type.toUpperCase()} DETECTED → Action: ${detectionResult.action}`);
              const emptyResponse = new VoiceResponse();
              return callback(null, emptyResponse);
            } else {
              console.log(`⏸️  No detection yet, continuing to monitor...`);
            }
          } catch (detectionError) {
            console.error('╔═══════════════════════════════════════════════════════════════╗');
            console.error('║                    DETECTION ERROR                             ║');
            console.error('╚═══════════════════════════════════════════════════════════════╝');
            console.error('❌ Error in processTranscriptionWithScenarios:', detectionError.message);
            console.error('❌ Stack trace:', detectionError.stack);
          }
        } else {
          console.log(`⚠️  Empty transcript received, skipping processing`);
        }
      } catch (parseError) {
        console.error('❌ Error parsing transcription data:', parseError.message);
        console.error('❌ Raw transcriptionData:', transcriptionData);
      }
      
      // Always return empty TwiML for transcription webhooks
      console.log('✅ Returning empty TwiML for transcription webhook');
      const emptyResponse = new VoiceResponse();
      return callback(null, emptyResponse);
    }
    
    // Handle transcription lifecycle events - these are status callbacks
    // Return empty TwiML to avoid falling through to default behavior
    if (transcriptionEvent === 'transcription-started') {
      console.log('╔═══════════════════════════════════════════════════════════════╗');
      console.log('║           TRANSCRIPTION SESSION STARTED                       ║');
      console.log('╚═══════════════════════════════════════════════════════════════╝');
      console.log(`🎙️  TranscriptionSid: ${transcriptionSid}`);
      console.log(`📞 Call: ${callSid}`);
      console.log('✅ Real-time transcription is now active');
      const emptyResponse = new VoiceResponse();
      return callback(null, emptyResponse);
    }
    
    if (transcriptionEvent === 'transcription-stopped') {
      console.log('╔═══════════════════════════════════════════════════════════════╗');
      console.log('║           TRANSCRIPTION SESSION STOPPED                       ║');
      console.log('╚═══════════════════════════════════════════════════════════════╝');
      console.log(`🛑 TranscriptionSid: ${transcriptionSid}`);
      console.log(`📞 Call: ${callSid}`);
      // DO NOT clean up processedActions here - we need to remember what we've done!
      // Only clean up transcripts to save memory
      callTranscripts.delete(callSid);
      console.log(`🧹 Cleaned up transcripts for call ${callSid} (keeping state and processed actions)`);
      const emptyResponse = new VoiceResponse();
      return callback(null, emptyResponse);
    }
    
    // ============================================================================
    // CALL CLEANUP - Only clean up when call actually completes
    // ============================================================================
    
    if (callStatus === 'completed' || callStatus === 'failed' || callStatus === 'canceled' || callStatus === 'no-answer') {
      console.log(`📞 Call ${callSid} ended with status: ${callStatus}`);
      cleanupCallState(callSid);
      const emptyResponse = new VoiceResponse();
      return callback(null, emptyResponse);
    }
    
    // ============================================================================
    // CALL INITIALIZATION - START PARALLEL AMD + TRANSCRIPTION
    // ============================================================================
    
    // Handle calls with undefined status (can happen with voicemail)
    // If we have a CallSid but no TranscriptionEvent and no CallStatus, treat it as in-progress
    const shouldInitialize = (callStatus === 'initiated' || callStatus === 'ringing' || 
                              callStatus === 'in-progress' || callStatus === 'answered') ||
                             (!callStatus && callSid && !transcriptionEvent);
    
    if (shouldInitialize) {
      console.log('╔═══════════════════════════════════════════════════════════════╗');
      console.log('║              CALL INITIALIZATION                              ║');
      console.log('╚═══════════════════════════════════════════════════════════════╝');
      console.log(`📞 CallStatus: ${callStatus || 'undefined (treating as in-progress)'}`);
      console.log(`📞 CallSid: ${callSid}`);
      
      // CRITICAL: Check if we've already initialized AND started transcription for this call
      // Twilio sends multiple webhooks (initial URL + status callbacks), but we only want
      // to start transcription ONCE. The key is checking if we're beyond INITIAL state.
      const existingState = getCallState(callSid);
      
      // If state is INITIAL, it means initializeCallState() was called but transcription
      // hasn't started yet. This can happen because the initial --url webhook creates
      // INITIAL state, then status callbacks arrive and should start transcription.
      // Only block if we're in a state BEYOND INITIAL (meaning transcription already started).
      if (existingState && existingState !== 'UNKNOWN' && existingState !== 'INITIAL') {
        console.log(`⚠️  DUPLICATE WEBHOOK - Call ${callSid} already initialized, in state: ${existingState}`);
        console.log(`✅ Returning continuation TwiML (pause + redirect) - transcription already running`);
        // Return continuation TwiML instead of empty response
        const continueResponse = new VoiceResponse();
        continueResponse.pause({ length: 60 });
        continueResponse.redirect(`https://${context.DOMAIN_NAME}/ios26_CallScreeningDetection_Transcriptions`);
        return callback(null, continueResponse);
      }
      
      // If we're in INITIAL state, we should proceed with starting transcription
      // This handles the race condition where --url webhook arrives first and creates
      // INITIAL state, then status callback arrives and needs to start transcription.
      if (existingState === 'INITIAL') {
        console.log(`✓ Call in INITIAL state - proceeding to start Real-time Transcription`);
      }
      
      console.log('🚀 INITIALIZING NEW CALL - Starting parallel real-time transcription and AMD detection...');
      
      // Initialize call state and timing
      initializeCallState(callSid);
      console.log(`✅ Call state initialized: ${getCallState(callSid)}`);
      
      // Start Real-time Transcription using VoiceResponse SDK (NOT raw XML)
      console.log('─────────────────────────────────────────────────────────────');
      console.log('🎯 STARTING REAL-TIME TRANSCRIPTION');
      console.log(`   StatusCallbackUrl: https://${context.DOMAIN_NAME}/ios26_CallScreeningDetection_Transcriptions`);
      console.log(`   Track: inbound_track`);
      console.log(`   Engine: google`);
      console.log(`   SpeechModel: telephony`);
      console.log(`   PartialResults: true`);
      console.log(`   Name: ios26-full-detection`);
      console.log('─────────────────────────────────────────────────────────────');
      
      // Use VoiceResponse SDK builder - this is the correct approach
      try {
        console.log('🔧 Creating VoiceResponse object...');
        const transcriptionResponse = new VoiceResponse();
        console.log('✅ VoiceResponse created');
        
        console.log('🔧 Calling transcriptionResponse.start()...');
        const start = transcriptionResponse.start();
        console.log(`✅ Start object created: ${typeof start}, has transcription: ${typeof start.transcription}`);
        
        console.log('🔧 Calling start.transcription() with attributes...');
        start.transcription({
          statusCallbackUrl: `https://${context.DOMAIN_NAME}/ios26_CallScreeningDetection_Transcriptions`,
          track: 'inbound_track',
          transcriptionEngine: 'google',
          speechModel: 'telephony',
          partialResults: false,
          name: 'ios26-full-detection'
        });
        console.log('✅ Transcription method called successfully');
        
        transcriptionResponse.pause({ length: 60 });
        transcriptionResponse.redirect(`https://${context.DOMAIN_NAME}/ios26_CallScreeningDetection_Transcriptions`);
        
        console.log('📋 GENERATED TWIML:');
        const twimlString = transcriptionResponse.toString();
        console.log(twimlString);
        console.log('─────────────────────────────────────────────────────────────');
        console.log('✅ Returning TwiML to start transcription');
        console.log('⏳ Waiting for transcription-started webhook...');
        console.log('═══════════════════════════════════════════════════════════════');
        
        return callback(null, transcriptionResponse);
      } catch (twimlError) {
        console.error('╔═══════════════════════════════════════════════════════════════╗');
        console.error('║           TWIML GENERATION ERROR                              ║');
        console.error('╚═══════════════════════════════════════════════════════════════╝');
        console.error('❌ Error generating TwiML:', twimlError.message);
        console.error('❌ Stack:', twimlError.stack);
        console.error('❌ Error type:', twimlError.constructor.name);
        
        // Return simple fallback TwiML
        const fallbackResponse = new VoiceResponse();
        fallbackResponse.say('An error occurred setting up transcription.');
        fallbackResponse.hangup();
        return callback(null, fallbackResponse);
      }
    }
    
    // ============================================================================
    // DEFAULT BEHAVIOR - CONTINUE MONITORING
    // ============================================================================
    
    console.log('⏳ Continuing call monitoring...');
    response.pause({ length: 60 });
    response.redirect(`https://${context.DOMAIN_NAME}/ios26_CallScreeningDetection_Transcriptions`);
    
    return callback(null, response);
    
  } catch (error) {
    console.error('❌ Error in iOS 26 full handler:', error);
    response.say('An error occurred. Goodbye.');
    response.hangup();
    return callback(null, response);
  }
};

// ============================================================================
// STATE MANAGEMENT - THE "MEMORY" OF OUR FUNCTION
// ============================================================================
/*
 * WHY WE NEED STATE MANAGEMENT:
 * 
 * Twilio Functions are "stateless" - each webhook is a separate invocation.
 * However, we need to "remember" things about a call across multiple webhooks:
 * - What stage is the call in? (INITIAL, IOS26_MONITORING, etc.)
 * - What have we detected so far? (accumulate transcripts)
 * - What actions have we already taken? (prevent duplicates)
 * - When did the call start? (for timing-based fallbacks)
 * 
 * We use JavaScript Maps (in-memory key-value stores) to track this state.
 * 
 * IMPORTANT: This works because:
 * 1. Multiple webhooks for the SAME call arrive to the SAME function instance
 * 2. Function instances stay "warm" for several minutes between invocations
 * 3. For production, you might want Redis or similar for distributed state
 * 
 * STATE LIFECYCLE:
 * 1. First webhook: initializeCallState() creates entries in all Maps
 * 2. Subsequent webhooks: read/update state as call progresses
 * 3. Call completes: cleanupCallState() removes entries to prevent memory leaks
 */

// Global Maps for tracking state across webhook invocations
const callStates = new Map();           // Current state: INITIAL → IOS26_MONITORING → PASSTHROUGH/VOICEMAIL_DELIVERED
const callTranscripts = new Map();      // Accumulated transcript text (all speech detected so far)
const callStartTimes = new Map();       // Timestamp when call started (for elapsed time calculations)
const amdResults = new Map();           // AMD (Answering Machine Detection) results from parallel analysis
const processedActions = new Map();     // Set of actions we've taken (ios26_response, voicemail_delivery, etc.)

/**
 * Initialize state tracking for a new call
 * 
 * Called when we receive the first webhook for a call (usually "initiated" or "ringing" status).
 * Sets up all the tracking we need for this call's lifecycle.
 * 
 * @param {string} callSid - Unique identifier for this call
 */
function initializeCallState(callSid) {
  callStates.set(callSid, 'INITIAL');          // Start in INITIAL state (haven't detected anything yet)
  callStartTimes.set(callSid, Date.now());     // Record start time for elapsed time calculations
  callTranscripts.set(callSid, '');            // Empty transcript accumulator
  console.log(`🆕 Initialized state for call ${callSid}`);
}

/**
 * Get current state of a call
 * 
 * States represent what we've detected so far:
 * - INITIAL: Just started, haven't detected anything yet
 * - IOS26_MONITORING: Detected iOS 26 preamble, monitoring for voicemail vs human
 * - PASSTHROUGH: Human detected, transcription stopped, call connected
 * - VOICEMAIL_DELIVERED: Voicemail detected, message delivered
 * 
 * @param {string} callSid - Call to check
 * @returns {string} Current state or 'UNKNOWN' if not found
 */
function getCallState(callSid) {
  return callStates.get(callSid) || 'UNKNOWN';
}

/**
 * Update state of a call
 * 
 * State transitions are one-way and sequential. Once we move forward,
 * we never go backwards. This prevents confusion and duplicate actions.
 * 
 * @param {string} callSid - Call to update
 * @param {string} newState - New state to transition to
 */
function setCallState(callSid, newState) {
  const oldState = callStates.get(callSid);
  callStates.set(callSid, newState);
  console.log(`🔄 State transition for ${callSid}: ${oldState} → ${newState}`);
}

/**
 * Store AMD (Answering Machine Detection) result for a call
 * 
 * AMD runs in parallel with transcription and sends its own webhook.
 * We store the result here so our transcription logic can reference it
 * as a secondary signal (transcription is primary, AMD is supplementary).
 * 
 * @param {string} callSid - Call to update
 * @param {string} result - AMD result: 'machine', 'human', 'fax', or 'unknown'
 */
function setAMDResult(callSid, result) {
  amdResults.set(callSid, result);
}

/**
 * Get AMD result for a call
 * 
 * @param {string} callSid - Call to check
 * @returns {string|undefined} AMD result or undefined if not yet received
 */
function getAMDResult(callSid) {
  return amdResults.get(callSid);
}

/**
 * Get elapsed time since call started (in seconds)
 * 
 * Used for timing-based fallback logic. For example:
 * - After 20 seconds with no iOS 26 detection → probably human answered directly
 * - After 25 seconds in iOS26_MONITORING → probably human picked up
 * 
 * @param {string} callSid - Call to check
 * @returns {number} Seconds elapsed since call started
 */
function getCallElapsedTime(callSid) {
  const startTime = callStartTimes.get(callSid);
  if (!startTime) return 0;
  return (Date.now() - startTime) / 1000;
}

/**
 * Check if an action has already been processed for this call
 * 
 * Prevents duplicate actions. For example, we don't want to:
 * - Play the identification message twice
 * - Leave two voicemail messages
 * - Send multiple Stop transcription commands
 * 
 * Actions we track: 'ios26_response', 'voicemail_delivery', 'human_after_ios26', 'human_passthrough'
 * 
 * @param {string} callSid - Call to check
 * @param {string} action - Action identifier
 * @returns {boolean} true if action has been processed, false otherwise
 */
function hasProcessedAction(callSid, action) {
  const actions = processedActions.get(callSid) || new Set();
  return actions.has(action);
}

/**
 * Mark an action as processed for this call
 */
function markActionProcessed(callSid, action) {
  let actions = processedActions.get(callSid);
  if (!actions) {
    actions = new Set();
    processedActions.set(callSid, actions);
  }
  actions.add(action);
  console.log(`✓ Marked action '${action}' as processed for ${callSid}`);
}

/**
 * Clean up all state for a call
 */
function cleanupCallState(callSid) {
  callStates.delete(callSid);
  callTranscripts.delete(callSid);
  callStartTimes.delete(callSid);
  amdResults.delete(callSid);
  processedActions.delete(callSid);
  console.log(`🧹 Cleaned up state for call ${callSid}`);
}

// ============================================================================
// ENHANCED TRANSCRIPTION PROCESSING WITH SCENARIO DETECTION
// ============================================================================

/**
 * Process transcription with all 4 scenario detection logic
// ============================================================================
// CORE SCENARIO DETECTION LOGIC - THE "BRAIN" OF THE FUNCTION
// ============================================================================
/*
 * This is where the magic happens! This function analyzes each piece of
 * transcribed speech and determines which of our 4 scenarios we're in.
 * 
 * HOW IT WORKS:
 * 1. Accumulate transcripts (build up what we've heard so far)
 * 2. Look for patterns (iOS 26 phrases, voicemail greetings, human speech)
 * 3. Consider timing (how long has the call been going?)
 * 4. Reference AMD (supplementary signal from parallel detection)
 * 5. Decide which scenario we're in and take appropriate action
 * 
 * SCENARIO CHECKING ORDER (important!):
 * We check scenarios in a specific order to avoid false positives:
 * 1. Scenario 3 FIRST (early human detection) - fastest scenario
 * 2. Scenario 1 (iOS 26 + eventual voicemail)
 * 3. Scenario 2 (iOS 26 + human picks up after preamble)
 * 4. Scenario 4 (direct voicemail, no iOS 26)
 * 
 * DESIGN PHILOSOPHY:
 * - Multi-layered detection (transcription + AMD + timing)
 * - Pattern matching on actual words (more reliable than AMD alone)
 * - Timing fallbacks ensure we never "hang" waiting forever
 * - Action tracking prevents duplicate operations
 * 
 * @param {string} transcript - The current piece of transcribed speech
 * @param {boolean} isFinal - Whether this is a final (confident) transcript
 * @param {string} callSid - Unique call identifier
 * @param {Object} context - Twilio Runtime context
 * @param {string} screeningResponse - Message to play after iOS 26 detection
 * @param {string} voicemailMessage - Message to leave on voicemail
 * @param {string} primaryPhrase - iOS 26 phrase we're listening for
 * @returns {Object|null} Detection result or null if no detection yet
 */
async function processTranscriptionWithScenarios(transcript, isFinal, callSid, context, screeningResponse, voicemailMessage, primaryPhrase) {
  console.log('[PROCESS_START] Inside processTranscriptionWithScenarios for call ' + callSid);
  console.log('[PROCESS_START] Transcript length: ' + (transcript ? transcript.length : 0) + ', isFinal: ' + isFinal);
  
  try {
    console.log('[STEP1] Starting try block');
    
    // ========================================================================
    // GATHER CONTEXT - What do we know about this call?
    // ========================================================================
    console.log('[STEP2] Getting call state...');
    const currentState = getCallState(callSid);
    console.log('[STEP3] Got state: ' + currentState);
    
    console.log(`[STEP3] Getting elapsed time...`);
    const elapsedTime = getCallElapsedTime(callSid);
    console.log(`[STEP4] Got elapsed time: ${elapsedTime}`);
    
    console.log(`[STEP5] Getting AMD result...`);
    const amdResult = getAMDResult(callSid);
    console.log(`[STEP6] Got AMD: ${amdResult || 'none'}`);
    
    console.log(`[PROCESS_START] State: ${currentState}, elapsed: ${elapsedTime}s, AMD: ${amdResult || 'none'}`);
    
    // ========================================================================
    // ACCUMULATE TRANSCRIPTS - Build conversation history
    // ========================================================================
    /*
     * WHY WE ACCUMULATE:
     * - Transcription comes in CHUNKS (partial results as speech is detected)
     * - Patterns might span multiple chunks ("Hi, if you" then "record your name")
     * - We keep last 300 chars to avoid memory issues with long calls
     * - This gives us context to match longer phrases
     */
    let accumulated = callTranscripts.get(callSid) || '';
    accumulated += ' ' + transcript.trim();
    if (accumulated.length > 300) {
      // Sliding window - keep most recent 300 characters
      accumulated = accumulated.slice(-300);
    }
    callTranscripts.set(callSid, accumulated);
    
    console.log(`🧠 Analyzing transcript in state ${currentState}, elapsed: ${elapsedTime.toFixed(1)}s, AMD: ${amdResult || 'none'}`);
    console.log(`   📝 Current transcript: "${transcript}"`);
    console.log(`   📚 Accumulated (last 300 chars): "${accumulated}"`);
  
    // ============================================================================
    // SCENARIO 3: NO CALL SCREENING + HUMAN (Early Human Detection)
    // ============================================================================
    /*
     * WHY CHECK THIS FIRST:
     * This is the fastest scenario - human answers immediately without iOS 26 screening.
     * If we detect human speech early (5-35 seconds) with NO iOS 26 patterns, we know
     * they answered directly. We can pass through immediately!
     * 
     * DETECTION SIGNALS:
     * - Transcription detects human speech patterns (hello, hey, yes, etc.)
     * - OR AMD says "human" (parallel confirmation)
     * - AND no iOS 26 patterns detected anywhere
     * - AND we're in INITIAL state (haven't detected iOS 26 yet)
     * - AND timing window is reasonable (5-35 seconds)
     * 
     * TIMING WINDOW RATIONALE:
     * - < 5s: Too early, might catch ringing or connection sounds
     * - 5-35s: Sweet spot for human answering
     * - > 35s: Probably went to voicemail or no answer
     */
  
    console.log(`[SCENARIO3_CHECK] Checking if Scenario 3 applies...`);
    console.log(`[SCENARIO3_CHECK]   State: ${currentState}, ElapsedTime: ${elapsedTime.toFixed(1)}s`);
    
    // Use transcription + AMD together for better detection
    // AMD helps with faster detection, transcription ensures accuracy
    if (currentState === 'INITIAL' && elapsedTime > 5 && elapsedTime < 35) {
      console.log(`[SCENARIO3_CHECK] ✓ Within time window (5-35s) and in INITIAL state`);
      
      // Check all our signals
      const isEarlyHuman = detectHumanSpeech(transcript) || detectHumanSpeech(accumulated);
      const noIOS26 = !detectIOS26Patterns(transcript) && !detectIOS26Patterns(accumulated);
      const amdSaysHuman = getAMDResult(callSid) === 'human';
      
      console.log(`[SCENARIO3_CHECK] Detection signals:`);
      console.log(`[SCENARIO3_CHECK]   - Transcription detects human: ${isEarlyHuman}`);
      console.log(`[SCENARIO3_CHECK]   - No iOS 26 patterns: ${noIOS26}`);
      console.log(`[SCENARIO3_CHECK]   - AsyncAMD says human: ${amdSaysHuman}`);
      
      // COMBINED SIGNAL: Trigger if either transcription OR AMD detects human
      // AND no iOS 26 patterns detected
      if ((isEarlyHuman || amdSaysHuman) && noIOS26) {
        const detectionMethod = isEarlyHuman && amdSaysHuman ? 'both transcription and AMD' : 
                               isEarlyHuman ? 'transcription' : 'AMD';
        
        console.log(`[SCENARIO3] 👤👤👤 SCENARIO 3 TRIGGERED via ${detectionMethod}`);
        console.log(`[SCENARIO3]    Time: ${elapsedTime.toFixed(1)}s`);
        console.log(`[SCENARIO3]    Transcript: "${transcript}"`);
        console.log(`[SCENARIO3]    Passing through to human conversation...`);
        
        // Prevent duplicate actions
        if (hasProcessedAction(callSid, 'human_passthrough')) {
          console.log(`[SCENARIO3] Already processed, skipping`);
          return null;
        }
        
        // Stop transcription and pass through to human
        await stopTranscriptionAndPassthrough(callSid, context);
        setCallState(callSid, 'PASSTHROUGH');
        markActionProcessed(callSid, 'human_passthrough');
        
        return { detected: true, type: 'scenario3', action: 'passthrough' };
      } else {
        console.log(`[SCENARIO3_CHECK] ✗ Scenario 3 not triggered`);
      }
    } else {
      console.log(`[SCENARIO3_CHECK] ✗ Outside time window or wrong state`);
    }
    
    // ========================================================================
    // TIMING FALLBACK FOR SCENARIO 3
    // ========================================================================
    /*
     * SAFETY NET:
     * If we're > 20 seconds into the call, still in INITIAL state, and haven't
     * detected iOS 26, we can be pretty confident a human answered directly.
     * 
     * WHY THIS MATTERS:
     * - Sometimes human speech isn't perfectly recognized by transcription
     * - AMD might miss or be delayed
     * - But if 20+ seconds have passed with no iOS 26, it's almost certainly human
     * 
     * This is a "fallback" - it catches cases where the primary detection missed
     */
    if (currentState === 'INITIAL' && elapsedTime > 20 && elapsedTime < 25) {
      const noIOS26InAccumulated = !detectIOS26Patterns(accumulated);
      const amdNotMachine = getAMDResult(callSid) !== 'machine_start' && getAMDResult(callSid) !== 'machine_end_beep';
      
      console.log(`[SCENARIO3_FALLBACK] Timing-based check at ${elapsedTime.toFixed(1)}s`);
      console.log(`[SCENARIO3_FALLBACK]   No iOS 26 in accumulated: ${noIOS26InAccumulated}`);
      console.log(`[SCENARIO3_FALLBACK]   AMD not machine: ${amdNotMachine}`);
      
      if (noIOS26InAccumulated && amdNotMachine && !hasProcessedAction(callSid, 'human_passthrough_fallback')) {
        console.log(`[SCENARIO3_FALLBACK] 👤 SCENARIO 3 TRIGGERED (fallback): No iOS 26 detected after 20s, assuming human`);
        
        await stopTranscriptionAndPassthrough(callSid, context);
        setCallState(callSid, 'PASSTHROUGH');
        markActionProcessed(callSid, 'human_passthrough_fallback');
        
        return { detected: true, type: 'scenario3_fallback', action: 'passthrough' };
      }
    }
    
    // ============================================================================
    // SCENARIO 4: NO CALL SCREENING + VOICEMAIL (Direct Voicemail)
    // ============================================================================
    /*
     * WHEN THIS HAPPENS:
     * - Call goes directly to voicemail without iOS 26 screening
     * - No human answers the phone
     * - We hear a regular voicemail greeting
     * 
     * DETECTION SIGNALS:
     * - Voicemail patterns in transcription ("leave a message after the tone", etc.)
     * - OR AMD says "machine" (voicemail is a machine)
     * - AND no iOS 26 patterns anywhere
     * - AND we're still in INITIAL state (haven't detected iOS 26 yet)
     * - AND within 30 second window (reasonable time for direct voicemail)
     * 
     * ACTION:
     * Leave our voicemail message directly - no identification message needed
     * since there was no iOS 26 screening to respond to.
     * 
     * TIMING WINDOW:
     * < 30s is reasonable for direct voicemail. Beyond that, we'd expect
     * either Scenario 3 (human) or call to end.
     */
    
    console.log(`[SCENARIO4_CHECK] Checking if Scenario 4 applies...`);
    console.log(`[SCENARIO4_CHECK]   State: ${currentState}, ElapsedTime: ${elapsedTime.toFixed(1)}s`);
    
    // CRITICAL: Never check for voicemail if we've already confirmed human (PASSTHROUGH state)
    // This prevents false positives where humans say phrases like "not available" in conversation
    if (currentState === 'PASSTHROUGH') {
      console.log(`[SCENARIO4_CHECK] ✗ Skipping - already in PASSTHROUGH (human confirmed)`);
      return null;
    }
    
    // Use transcription + AMD together for better detection
    if (currentState === 'INITIAL' && elapsedTime < 30) {
      console.log(`[SCENARIO4_CHECK] ✓ In INITIAL state and within 30s window`);
      
      // Check all our signals
      const isVoicemail = detectVoicemailPatterns(transcript) || detectVoicemailPatterns(accumulated);
      const noIOS26 = !detectIOS26Patterns(transcript) && !detectIOS26Patterns(accumulated);
      const amdSaysMachine = getAMDResult(callSid) === 'machine_start' || getAMDResult(callSid) === 'machine_end_beep';
      
      console.log(`[SCENARIO4_CHECK] Detection signals:`);
      console.log(`[SCENARIO4_CHECK]   - Transcription detects voicemail: ${isVoicemail}`);
      console.log(`[SCENARIO4_CHECK]   - No iOS 26 patterns: ${noIOS26}`);
      console.log(`[SCENARIO4_CHECK]   - AsyncAMD says machine: ${amdSaysMachine}`);
      
      // COMBINED SIGNAL: Trigger if either transcription OR AMD detects machine
      // AND no iOS 26 patterns detected
      // This distinguishes Scenario 4 (direct voicemail) from Scenario 1 (iOS 26 then voicemail)
      if ((isVoicemail || amdSaysMachine) && noIOS26) {
        const detectionMethod = isVoicemail && amdSaysMachine ? 'both transcription and AMD' : 
                               isVoicemail ? 'transcription' : 'AMD';
        
        console.log(`[SCENARIO4] 📬📬📬 SCENARIO 4 TRIGGERED via ${detectionMethod}`);
        console.log(`[SCENARIO4]    Time: ${elapsedTime.toFixed(1)}s`);
        console.log(`[SCENARIO4]    Voicemail text: "${transcript}"`);
        
        // Prevent duplicate voicemail delivery
        if (hasProcessedAction(callSid, 'voicemail_direct')) {
          console.log(`[SCENARIO4] Already processed, skipping`);
          return null;
        }
        
        // CRITICAL: Mark action IMMEDIATELY to prevent race conditions
        // Multiple transcription webhooks can arrive simultaneously
        markActionProcessed(callSid, 'voicemail_direct');
        setCallState(callSid, 'VOICEMAIL_DELIVERED');
        console.log(`[SCENARIO4] ✅ Marked action (preventing race condition)`);
        
        // Leave voicemail message directly (no identification message needed)
        console.log(`[SCENARIO4] Calling leaveVoicemailMessage...`);
        await leaveVoicemailMessage(callSid, context, voicemailMessage);
        console.log(`[SCENARIO4] ✅ Voicemail message sent directly`);
        
        return { detected: true, type: 'scenario4', action: 'voicemail' };
      } else {
        console.log(`[SCENARIO4_CHECK] ✗ Not triggered`);
      }
    } else {
      console.log(`[SCENARIO4_CHECK] ✗ Wrong state or outside time window`);
    }
    
    // ============================================================================
    // SCENARIO 1: iOS 26 PREAMBLE DETECTION (Initial Detection)
    // ============================================================================
    /*
     * WHEN THIS HAPPENS:
     * - iOS 26 call screening activates on recipient's phone
     * - We hear: "Hi, if you record your name and reason for calling, I'll see if this person is available"
     * - This is the ENTRY POINT for both Scenario 1 (voicemail) and Scenario 2 (human picks up)
     * 
     * WHAT WE DO:
     * 1. Detect the iOS 26 preamble via pattern matching
     * 2. Play our identification message (who we are and why we're calling)
     * 3. Transition to IOS26_MONITORING state
     * 4. Continue monitoring to determine if it becomes Scenario 1 or Scenario 2
     * 
     * WHY THIS IS SEPARATE:
     * We can't know YET whether the human will pick up (Scenario 2) or if it will
     * go to voicemail (Scenario 1). So we detect iOS 26, respond, then MONITOR
     * to see what happens next.
     * 
     * STATE TRANSITION:
     * INITIAL → IOS26_MONITORING
     * 
     * From IOS26_MONITORING, we'll then detect:
     * - Voicemail patterns → Complete Scenario 1
     * - Human speech → Complete Scenario 2
     */
    
    console.log(`[SCENARIO1_CHECK] Checking if Scenario 1 applies...`);
    console.log(`[SCENARIO1_CHECK]   State: ${currentState}`);
    
    if (currentState === 'INITIAL') {
      console.log(`[SCENARIO1_CHECK] ✓ In INITIAL state`);
      
      // Look for iOS 26 patterns in both current transcript and accumulated text
      const isIOS26 = detectIOS26Patterns(transcript) || detectIOS26Patterns(accumulated);
      console.log(`[SCENARIO1_CHECK] iOS 26 patterns detected: ${isIOS26}`);
      console.log(`[SCENARIO1_CHECK]   - In transcript: ${detectIOS26Patterns(transcript)}`);
      console.log(`[SCENARIO1_CHECK]   - In accumulated: ${detectIOS26Patterns(accumulated)}`);
      
      if (isIOS26) {
        console.log(`[SCENARIO1] 🎯🎯🎯 iOS 26 PREAMBLE DETECTED at ${elapsedTime.toFixed(1)}s`);
        console.log(`[SCENARIO1]    Transcript: "${transcript}"`);
        console.log(`[SCENARIO1]    Accumulated: "${accumulated}"`);
        console.log(`[SCENARIO1]    This is the entry point for both Scenario 1 and Scenario 2`);
        console.log(`[SCENARIO1]    We'll now respond and continue monitoring to see which scenario unfolds...`);
        
        // Check current state - if already IOS26_MONITORING, another webhook already handled this
        const currentState = getCallState(callSid);
        if (currentState === 'IOS26_MONITORING') {
          console.log(`[SCENARIO1] ✅ Already in IOS26_MONITORING state - another webhook handled this`);
          return null;
        }
        
        // Transition state immediately to claim this detection
        setCallState(callSid, 'IOS26_MONITORING');
        console.log(`[SCENARIO1] ✅ Transitioned to IOS26_MONITORING state`);
        
        // Play our identification message via REST API
        // The duplicate protection is handled INSIDE playIOS26Response() with Twilio API checks
        console.log(`[SCENARIO1] Calling playIOS26Response...`);
        const result = await playIOS26Response(callSid, context, screeningResponse);
        
        if (result === 'ABORTED') {
          console.log(`[SCENARIO1] ⚠️ playIOS26Response was aborted (already sent by another webhook)`);
          return null;
        }
        
        console.log(`[SCENARIO1] ✅ iOS 26 response sent`);
        console.log(`[SCENARIO1] ⏳ Continuing to monitor for voicemail or human speech...`);
        
        return { detected: true, type: 'scenario1', action: 'ios26_response' };
      }
      
      // ========================================================================
      // RETROACTIVE iOS 26 DETECTION - A Smart Fallback (PRIMARY METHOD)
      // ========================================================================
      /*
       * THE PROBLEM:
       * Transcription has inherent startup latency (2-5 seconds). By the time
       * transcription starts sending data, the iOS 26 preamble may already be over.
       * We might MISS the preamble but catch the NEXT thing iOS 26 says:
       * "Thanks, stay on the line" or "Stay on the line"
       * 
       * THE SOLUTION:
       * If we detect these "intermediate prompts" early in the call (< 12 seconds),
       * we can INFER that iOS 26 was active but we missed the preamble.
       * 
       * WHY THIS WORKS:
       * - "Thanks, stay on the line" only appears in iOS 26 flow
       * - iOS 26 preamble plays at 0-5s, intermediate prompt at 5-8s
       * - If transcription catches it by 12s, iOS 26 must have been active
       * - Better to respond late than not at all!
       * 
       * TIMING:
       * < 12s window because:
       * - iOS 26 preamble: 0-5 seconds
       * - Intermediate prompt: 5-8 seconds  
       * - Transcription delay: 2-4 seconds
       * - Detection window: 8-12 seconds is realistic
       * 
       * AMD CONFIRMATION:
       * We also check if AMD detected "machine_start". If BOTH signals agree,
       * we have very high confidence it's iOS 26.
       */
      console.log(`[SCENARIO1_RETRO] Checking for retroactive iOS 26 detection...`);
      const isIntermediatePrompt = detectIntermediatePrompts(transcript);
      const amdSaysMachine = getAMDResult(callSid) === 'machine_start' || getAMDResult(callSid) === 'machine_end_beep';
      console.log(`[SCENARIO1_RETRO] Intermediate prompt detected: ${isIntermediatePrompt}`);
      console.log(`[SCENARIO1_RETRO] AMD says machine: ${amdSaysMachine} (result: ${getAMDResult(callSid)})`);
      console.log(`[SCENARIO1_RETRO] Elapsed time: ${elapsedTime.toFixed(1)}s (threshold: < 12s)`);
      
      // TRIGGER if we detect intermediate prompt early (with or without AMD confirmation)
      // AMD confirmation increases confidence but isn't required
      // TRIGGER if we detect intermediate prompt early (with or without AMD confirmation)
      // AMD confirmation increases confidence but isn't required
      if (isIntermediatePrompt && elapsedTime < 12) {
        const confidence = amdSaysMachine ? 'HIGH (transcription + AMD)' : 'MEDIUM (transcription only)';
        console.log(`[SCENARIO1_RETRO] 🔄🔄🔄 INFERRED iOS 26: Intermediate prompt "${transcript}" at ${elapsedTime.toFixed(1)}s`);
        console.log(`[SCENARIO1_RETRO]    Confidence: ${confidence}`);
        console.log(`[SCENARIO1_RETRO]    Transcription likely started too late to catch iOS 26 preamble`);
        console.log(`[SCENARIO1_RETRO]    Sending our identification now (better late than never!)`);
        
        // Check current state - if already IOS26_MONITORING, another webhook already handled this
        const currentState = getCallState(callSid);
        if (currentState === 'IOS26_MONITORING') {
          console.log(`[SCENARIO1_RETRO] ✅ Already in IOS26_MONITORING state - another webhook handled this`);
          return null;
        }
        
        // Transition state immediately to claim this detection
        setCallState(callSid, 'IOS26_MONITORING');
        console.log(`[SCENARIO1_RETRO] ✅ Transitioned to IOS26_MONITORING state`);
        
        // Send our response even though we're late - iOS 26 is still listening!
        // The duplicate protection is handled INSIDE playIOS26Response() with Twilio API checks
        console.log(`[SCENARIO1_RETRO] Calling playIOS26Response...`);
        const result = await playIOS26Response(callSid, context, screeningResponse);
        
        if (result === 'ABORTED') {
          console.log(`[SCENARIO1_RETRO] ⚠️ playIOS26Response was aborted (already sent by another webhook)`);
          return null;
        }
        
        console.log(`[SCENARIO1_RETRO] ✅ Sent late identification`);
        
        return { detected: true, type: 'scenario1_inferred', action: 'ios26_response_late' };
      } else {
        console.log(`[SCENARIO1_RETRO] ✗ No intermediate prompt or outside time window (${elapsedTime.toFixed(1)}s > 12s)`);
      }
      
      console.log(`[SCENARIO1_CHECK] ✗ No iOS 26 patterns detected`);
    } else {
      console.log(`[SCENARIO1_CHECK] ✗ Not in INITIAL state`);
    }
    
    // ============================================================================
    // SCENARIO 2: HUMAN AFTER iOS 26 RESPONSE (The Tricky One!)
    // ============================================================================
    /*
     * WHEN THIS HAPPENS:
     * 1. iOS 26 screening activated (we detected preamble)
     * 2. We played our identification message
     * 3. Human was listening/viewing on their screen
     * 4. Human decided to ANSWER the call (tapped "Accept")
     * 5. We're now in IOS26_MONITORING state
     * 
     * WHAT WE NEED TO DETECT:
     * - Human speech AFTER iOS 26 but BEFORE voicemail
     * - This means the human picked up the call!
     * 
     * WHY THIS IS TRICKY:
     * We've already played our identification message (to iOS 26). Now the human
     * is connected. We need to:
     * 1. Detect they're there (human speech patterns)
     * 2. STOP transcription immediately (no more monitoring needed)
     * 3. Pass the call through so they can talk
     * 4. DON'T play the identification message again (they already heard it!)
     * 
     * THE CHALLENGE:
     * We must distinguish between:
     * - iOS 26 intermediate prompts ("stay on the line") - IGNORE these
     * - Voicemail greeting - Go to Scenario 1 completion
     * - Real human speech - THIS is Scenario 2!
     * 
     * STATE TRANSITION:
     * IOS26_MONITORING → PASSTHROUGH (stop transcription, connect human)
     * 
     * TIMING FALLBACK:
     * If we're in IOS26_MONITORING for > 25 seconds with no voicemail patterns,
     * assume human picked up (maybe they're silent or transcription missed their speech)
     */
    
    console.log(`[SCENARIO2_CHECK] Checking if Scenario 2 applies...`);
    console.log(`[SCENARIO2_CHECK]   State: ${currentState}`);
    
    if (currentState === 'IOS26_MONITORING') {
      console.log(`[SCENARIO2_CHECK] ✓ In IOS26_MONITORING state`);
      
      // ======================================================================
      // STEP 1: Filter out iOS 26 intermediate prompts
      // ======================================================================
      /*
       * iOS 26 might say things like:
       * - "Thanks, stay on the line"
       * - "Stay on the line"
       * 
       * These aren't the human - it's still iOS 26 talking!
       * We need to IGNORE these and keep monitoring.
       */
      const isIntermediatePrompt = detectIntermediatePrompts(transcript);
      console.log(`[SCENARIO2_CHECK] Intermediate prompt check: ${isIntermediatePrompt}`);
      console.log(`[SCENARIO2_CHECK]   Transcript: "${transcript}"`);
      
      if (isIntermediatePrompt) {
        console.log(`[SCENARIO2_INTER] ⏸️ iOS 26 intermediate prompt detected: "${transcript}" - continuing to monitor`);
        console.log(`[SCENARIO2_INTER]    This is still iOS 26 speaking, not the human. Keep monitoring...`);
        return null; // Not done yet, keep monitoring
      }
      
      // ======================================================================
      // STEP 2: Check if it went to voicemail (Scenario 1 completion)
      // ======================================================================
      /*
       * If we detect voicemail patterns NOW (while in IOS26_MONITORING),
       * it means:
       * 1. iOS 26 was active (we detected and responded)
       * 2. Call went to voicemail instead of human picking up
       * 3. This completes SCENARIO 1 (not Scenario 2)
       * 
       * Action: Leave voicemail message
       */
      const isVoicemail = detectVoicemailPatterns(transcript) || detectVoicemailPatterns(accumulated);
      console.log(`[SCENARIO2_VM] Voicemail check: ${isVoicemail}`);
      console.log(`[SCENARIO2_VM]   In transcript: ${detectVoicemailPatterns(transcript)}`);
      console.log(`[SCENARIO2_VM]   In accumulated: ${detectVoicemailPatterns(accumulated)}`);
      
      if (isVoicemail) {
        console.log(`[SCENARIO2_VM] 📬📬📬 SCENARIO 1 (continued): Voicemail detected after iOS 26 response`);
        console.log(`[SCENARIO2_VM]    The call went to voicemail, so this is Scenario 1, not Scenario 2`);
        console.log(`[SCENARIO2_VM]    Transcript: "${transcript}"`);
        console.log(`[SCENARIO2_VM]    Accumulated: "${accumulated}"`);
        
        if (hasProcessedAction(callSid, 'voicemail_after_ios26')) {
          console.log(`[SCENARIO2_VM] Already processed voicemail_after_ios26, skipping`);
          return null;
        }
        
        // CRITICAL: Mark action IMMEDIATELY to prevent race conditions
        // Multiple transcription webhooks can arrive simultaneously
        markActionProcessed(callSid, 'voicemail_after_ios26');
        setCallState(callSid, 'VOICEMAIL_DELIVERED');
        console.log(`[SCENARIO2_VM] ✅ Marked action (preventing race condition)`);
        
        // Leave voicemail message (completing Scenario 1)
        console.log(`[SCENARIO2_VM] Calling leaveVoicemailMessage...`);
        await leaveVoicemailMessage(callSid, context, voicemailMessage);
        console.log(`[SCENARIO2_VM] ✅ Voicemail message sent`);
        
        return { detected: true, type: 'scenario1_voicemail', action: 'voicemail' };
      }
      
      // ======================================================================
      // STEP 3: Check for HUMAN SPEECH (Scenario 2 trigger!)
      // ======================================================================
      /*
       * This is what we're really looking for in Scenario 2:
       * Real human speech patterns like "hello", "hey", "yes", etc.
       * 
       * If we detect this, it means:
       * 1. iOS 26 was active (we detected and responded)
       * 2. Human was listening/viewing
       * 3. Human decided to ANSWER (tapped Accept)
       * 4. Now they're connected and talking!
       * 
       * Action: STOP transcription and pass call through
       * 
       * CRITICAL: Do NOT play identification again - they already heard it
       * during the iOS 26 screening!
       */
      const isHuman = detectHumanSpeech(transcript) || detectHumanSpeech(accumulated);
      console.log(`[SCENARIO2_HUMAN] Human speech check: ${isHuman}`);
      console.log(`[SCENARIO2_HUMAN]   In transcript: ${detectHumanSpeech(transcript)}`);
      console.log(`[SCENARIO2_HUMAN]   In accumulated: ${detectHumanSpeech(accumulated)}`);
      console.log(`[SCENARIO2_HUMAN]   Transcript: "${transcript}"`);
      console.log(`[SCENARIO2_HUMAN]   Accumulated: "${accumulated}"`);
      
      if (isHuman) {
        console.log(`[SCENARIO2] 👤👤👤 SCENARIO 2 TRIGGERED: Human detected after iOS 26 response!`);
        console.log(`[SCENARIO2]    The human picked up the call!`);
        console.log(`[SCENARIO2]    Human speech: "${transcript}"`);
        console.log(`[SCENARIO2]    Elapsed time: ${elapsedTime.toFixed(1)}s`);
        console.log(`[SCENARIO2]    Stopping transcription and connecting them...`);
        
        if (hasProcessedAction(callSid, 'human_after_ios26')) {
          console.log(`[SCENARIO2] Already processed human_after_ios26, skipping`);
          return null;
        }
        
        // Stop transcription immediately - no more monitoring needed
        // Pass call through so human can talk
        // DO NOT play voicemail message or identification again!
        console.log(`[SCENARIO2] Calling stopTranscriptionAndPassthrough...`);
        await stopTranscriptionAndPassthrough(callSid, context);
        setCallState(callSid, 'PASSTHROUGH');
        markActionProcessed(callSid, 'human_after_ios26');
        console.log(`[SCENARIO2] ✅ Transcription stopped, human is now connected`);
        
        return { detected: true, type: 'scenario2', action: 'passthrough' };
      }
      
      console.log(`[SCENARIO2_CHECK] ✗ No human or voicemail detected yet, continuing to monitor`);
    } else {
      console.log(`[SCENARIO2_CHECK] ✗ Not in IOS26_MONITORING state`);
    }
    
    // No scenario detected in this iteration - keep monitoring
    return null;
  
  } catch (error) {
    console.error(`[ERROR] Exception in processTranscriptionWithScenarios:`, error);
    console.error(`[ERROR] Stack:`, error.stack);
    return null;
  }
}

// ============================================================================
// PATTERN DETECTION FUNCTIONS - THE "EARS" OF OUR SYSTEM
// ============================================================================
/*
 * These functions analyze transcribed text to identify specific patterns.
 * Think of them as specialized "listeners" that recognize different types
 * of speech:
 * 
 * 1. iOS 26 patterns - Detects iOS call screening preambles
 * 2. Intermediate prompts - Recognizes iOS 26 follow-up messages
 * 3. Voicemail patterns - Identifies voicemail greetings
 * 4. Human speech - Detects real human conversation
 * 
 * WHY PATTERN MATCHING WORKS:
 * - iOS 26 always says similar things ("record your name and reason for calling")
 * - Voicemail greetings follow predictable formats ("leave a message after the tone")
 * - Human speech has distinctive patterns ("hello", "hey", questions with "?")
 * 
 * DESIGN APPROACH:
 * - Multiple patterns per category (accounts for variations)
 * - Case-insensitive matching (works regardless of transcription capitalization)
 * - Partial matching allowed (catches phrases even if slightly misheard)
 * 
 * IMPORTANT:
 * These functions are simple but effective. They return true/false based on
 * whether ANY of the patterns match. This is intentionally liberal - better
 * to detect something that might be there than miss it entirely!
 */

/**
 * Detect iOS 26 call screening patterns
 * 
 * PURPOSE:
 * Identify when iOS 26 is speaking its initial preamble. This is THE key
 * detection that triggers everything else.
 * 
 * WHAT WE'RE LISTENING FOR:
 * The iOS 26 preamble typically says:
 * "Hi, if you record your name and reason for calling, I'll see if this person is available"
 * 
 * But transcription might not be perfect, so we match multiple variations
 * and partial phrases.
 * 
 * WHY MULTIPLE PATTERNS:
 * - Transcription isn't perfect - might catch only part of the phrase
 * - iOS 26 wording varies slightly between iOS versions
 * - Better to be liberal and catch variations than miss the detection
 * 
 * @param {string} text - Transcribed text to analyze
 * @returns {boolean} true if iOS 26 patterns detected, false otherwise
 */
function detectIOS26Patterns(text) {
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  
  // List of phrases that indicate iOS 26 is active
  // Ordered from most specific (full phrase) to more general (partial phrases)
  const ios26Patterns = [
    // Full phrases (highest confidence)
    'record your name and reason for calling',
    'if you record your name',
    'name and reason for calling',
    'see if this person is available',
    "i'll see if this person",
    
    // Partial matches (still strong indicators)
    // These catch cases where transcription only got part of the preamble
    'record your name',
    'reason for calling',
    'reason for your call',
    'state your name',
    'say your name',
    'this person is available',
    'see if this person',
    'checking if this person'
  ];
  
  // Return true if ANY pattern matches
  // .some() stops as soon as it finds a match (efficient!)
  return ios26Patterns.some(pattern => lowerText.includes(pattern));
}

/**
 * Detect iOS 26 intermediate prompts (keep monitoring)
 * 
 * PURPOSE:
 * After iOS 26's initial preamble, it sometimes says follow-up prompts like:
 * "Thanks, stay on the line" or "Thank you, please stay on the line"
 * 
 * These are NOT the human speaking - it's still iOS 26! We need to recognize
 * these so we don't mistakenly think the human picked up.
 * 
 * WHY THIS MATTERS:
 * When we're in IOS26_MONITORING state (waiting to see if human picks up or
 * goes to voicemail), we might hear these prompts. We need to IGNORE them
 * and keep monitoring.
 * 
 * ALSO USED FOR RETROACTIVE DETECTION:
 * If we hear "thanks, stay on the line" early in a call, we can INFER that
 * iOS 26 was active but we missed the preamble (transcription started late).
 * 
 * @param {string} text - Transcribed text to analyze
 * @returns {boolean} true if intermediate prompts detected, false otherwise
 */
function detectIntermediatePrompts(text) {
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  
  // Phrases iOS 26 says AFTER the preamble
  const intermediatePatterns = [
    'thanks',          // Often just transcribed as "thanks"
    'thank you',       // Sometimes transcribed more fully
    'please stay on the line',
    'stay on the line',
    'please hold',
    'one moment'
  ];
  
  // IMPORTANT: Only match if it's JUST these short phrases
  // If there's a lot of other speech, it's probably a human talking, not iOS 26
  const words = lowerText.split(/\s+/);
  if (words.length > 10) return false; // Too long to be just a prompt
  
  return intermediatePatterns.some(pattern => lowerText.includes(pattern));
}

/**
 * Detect voicemail patterns
 * 
 * PURPOSE:
 * Identify when we've reached a voicemail greeting. This could be:
 * 1. Personal voicemail (user recorded their own greeting)
 * 2. Default voicemail (carrier's generic "leave a message after the tone")
 * 3. Carrier forwarding messages ("call has been forwarded to voicemail")
 * 
 * WHY THIS IS IMPORTANT:
 * We need to distinguish voicemail from:
 * - iOS 26 prompts (both are "machines" but behave differently)
 * - Human speech (very different!)
 * 
 * TWO TYPES OF VOICEMAIL DETECTION:
 * 1. Scenario 1: Voicemail AFTER iOS 26 (we're in IOS26_MONITORING state)
 * 2. Scenario 4: Direct voicemail, no iOS 26 (we're in INITIAL state)
 * 
 * CARRIER MESSAGES:
 * When a call is forwarded or goes to voicemail, carriers often say:
 * "The call has been forwarded to an automatic voice message system"
 * "The person you are trying to reach is unavailable"
 * 
 * These are STRONG indicators of voicemail (Scenario 4)!
 * 
 * @param {string} text - Transcribed text to analyze
 * @returns {boolean} true if voicemail patterns detected, false otherwise
 */
function detectVoicemailPatterns(text) {
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  
  // Comprehensive list of voicemail indicators
  const voicemailPatterns = [
    // Standard voicemail prompts
    'leave a message',
    'leave an additional message',
    'after the tone',
    'after the beep',
    'not available',
    'unable to take your call',
    'voicemail',
    'please leave',
    'at the sound of the beep',
    
    // Personal greeting phrases
    'can\'t come to the phone',
    'cannot come to the phone',
    'can\'t take your call',
    'cannot take your call',
    'please call back',
    'call back later',
    'try again later',
    'leave your name and number',
    'record your message',
    'recording',
    'mailbox',
    
    // Carrier voicemail messages (SCENARIO 4 - very important!)
    // These appear when call is forwarded or goes directly to voicemail
    'call has been forwarded',
    'forwarded to voicemail',
    'forwarded to an automatic voice message',
    'person you are trying to reach',
    'person you\'re trying to reach',
    'person you are calling',
    'subscriber you are calling',
    'subscriber you have called',
    'is unavailable',
    'is not available'
  ];
  
  // Return true if ANY pattern matches
  return voicemailPatterns.some(pattern => lowerText.includes(pattern));
}

/**
 * Detect human speech (err on side of caution!)
 * 
 * PURPOSE:
 * Identify when a real human is speaking (not iOS 26, not voicemail, but an
 * actual person having a conversation).
 * 
 * WHY THIS IS THE HARDEST:
 * - Humans say all kinds of things (infinite variety!)
 * - We need to distinguish from pre-recorded messages
 * - We want to avoid false positives (thinking voicemail is human)
 * 
 * OUR STRATEGY:
 * 1. First, EXCLUDE things we KNOW aren't human:
 *    - iOS 26 patterns
 *    - Voicemail patterns
 *    - Intermediate prompts
 * 2. Then, look for POSITIVE indicators of human speech:
 *    - Common greetings ("hello", "hey")
 *    - Questions (anything with "?")
 *    - Conversational phrases ("who is this", "what do you want")
 * 
 * ERR ON THE SIDE OF CAUTION:
 * It's better to pass through to a human (even if we're unsure) than to
 * leave a voicemail message on a human! So our detection is deliberately
 * liberal.
 * 
 * @param {string} text - Transcribed text to analyze
 * @returns {boolean} true if human speech detected, false otherwise
 */
function detectHumanSpeech(text) {
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  
  // STEP 1: EXCLUDE known non-human patterns
  // If it matches iOS 26 or voicemail, it's NOT human
  if (detectIOS26Patterns(text) || detectVoicemailPatterns(text)) {
    return false;
  }
  
  // Also exclude iOS 26 intermediate prompts
  if (detectIntermediatePrompts(text)) {
    return false;
  }
  
  // STEP 2: Check for voicemail greeting patterns
  // These sound like humans but are pre-recorded, not interactive
  // CRITICAL: Filter these out to avoid false positives
  const voicemailGreetingPatterns = [
    "can't come to the phone",
    "cannot come to the phone",
    "can't take your call",
    "cannot take your call",
    "not available right now",
    "not available to take",
    "unable to answer",
    "away from my phone",
    "please leave a message",
    "you've reached",
    "you have reached",
    "this is the voicemail",
    "at the tone"
  ];
  
  if (voicemailGreetingPatterns.some(pattern => lowerText.includes(pattern))) {
    console.log(`🚫 Voicemail greeting detected, NOT human: "${text}"`);
    return false;
  }
  
  // Now check for human speech indicators - but ONLY if they're truly interactive
  const humanPatterns = [
    'who is this',      // Questions (interactive)
    'who are you',
    'what do you want',
    'hold on',          // Interactive commands
    'wait',
    'speaking',         // Direct responses
    'this is'           // Self-identification
  ];
  
  // If we match human patterns, it's likely human
  const hasHumanPattern = humanPatterns.some(pattern => lowerText.includes(pattern));
  
  // ONLY consider question marks if there are interactive keywords
  const hasQuestionMark = text.includes('?');
  const hasInteractiveQuestion = hasQuestionMark && (
    lowerText.includes('who') || 
    lowerText.includes('what') || 
    lowerText.includes('why')
  );
  
  return hasHumanPattern || hasInteractiveQuestion;
}

// ============================================================================
// ACTION FUNCTIONS (REST API CALLS)
// ============================================================================
//
// These functions take ACTION on the call after detection is complete.
// They use Twilio's REST API (not TwiML webhooks) to modify a live call.
//
// THREE ACTIONS:
// 1. playIOS26Response - Play identification to iOS 26, restart monitoring
// 2. leaveVoicemailMessage - Leave message after voicemail beep
// 3. stopTranscriptionAndPassthrough - Stop monitoring, let call continue
//
// ============================================================================

/**
 * Play iOS 26 identification response (SCENARIO 1 & 2)
 * 
 * PURPOSE:
 * When iOS 26 is detected, we need to identify ourselves ("This is Bobby calling
 * from XYZ company..."). This function plays that identification message into
 * the live call.
 * 
 * WHY USE REST API INSTEAD OF RETURNING TwiML?
 * Great question! This webhook is for transcription events (status callbacks),
 * not call control. We can't return TwiML from these webhooks - Twilio would
 * ignore it! Instead, we use the REST API to UPDATE the live call with new TwiML.
 * 
 * WHAT HAPPENS AFTER WE IDENTIFY OURSELVES?
 * Two possibilities:
 * - SCENARIO 1: Call goes to voicemail (iOS 26 rejected us)
 * - SCENARIO 2: Human picks up (iOS 26 accepted us)
 * 
 * So after playing our identification, we RESTART transcription monitoring to
 * detect which scenario unfolds. That's why the TwiML includes a new <Start>
 * <Transcription> element.
 * 
 * THE PAUSE & REDIRECT:
 * After starting transcription, we add a 90-second pause. This gives time for:
 * - The human to pick up, OR
 * - Voicemail to kick in
 * Then we redirect back to this function (which will handle cleanup).
 * 
 * CRITICAL: This should only be called ONCE per call! Multiple calls would play
 * the identification multiple times (confusing and unprofessional).
 * 
 * @param {string} callSid - The Call SID to update
 * @param {object} context - Twilio function context (contains getTwilioClient, env vars)
 * @param {string} screeningResponse - The identification message to play
 */
async function playIOS26Response(callSid, context, screeningResponse) {
  try {
    console.log(`🚨🚨🚨 CRITICAL: playIOS26Response() CALLED for call ${callSid} 🚨🚨🚨`);
    console.log(`🚨 This function should ONLY be called ONCE per call!`);
    
    const client = context.getTwilioClient();
    
    // CRITICAL SAFEGUARD #1: Wait a tiny bit and then check if call was already updated
    // This gives any concurrent webhook a chance to win the race
    await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
    
    // CRITICAL SAFEGUARD #2: Query the call to see if it's already been updated
    let call;
    try {
      call = await client.calls(callSid).fetch();
      console.log(`📊 Current call status: ${call.status}`);
      
      // If the call is already in a terminal state, don't update
      if (call.status === 'completed' || call.status === 'busy' || call.status === 'failed' || call.status === 'canceled') {
        console.log(`🚨 ABORT: Call ${callSid} is in terminal state ${call.status}, cannot update!`);
        return 'ABORTED';
      }
      
      // Check if the call has already had custom TwiML applied
      // If the call was recently updated (within last second), another webhook likely got it
      if (call.dateUpdated) {
        const updatedAt = new Date(call.dateUpdated);
        const now = new Date();
        const msSinceUpdate = now - updatedAt;
        console.log(`📊 Call was last updated ${msSinceUpdate}ms ago`);
        
        if (msSinceUpdate < 2000) { // Updated within last 2 seconds
          console.log(`🚨 ABORT: Call was recently updated (${msSinceUpdate}ms ago) - likely by another webhook`);
          return 'ABORTED';
        }
      }
    } catch (fetchError) {
      console.error(`⚠️ Warning: Could not fetch call status:`, fetchError.message);
      // Continue anyway - the update will fail if call is invalid
    }
    
    // Build TwiML as raw XML
    // WHY RAW XML? The Twilio Node.js SDK (version 5.x) doesn't have a
    // .transcription() method on VoiceResponse. So we write XML directly.
    const voice = context.TWILIO_VOICE || 'alice';
    const language = context.TWILIO_LANGUAGE || 'en-US';
    
    // This TwiML does THREE things:
    // 1. <Say> - Play our identification message
    // 2. <Start><Transcription> - Restart transcription to monitor what happens next
    // 3. <Pause> - Give time for voicemail/human, call ends naturally when someone hangs up
    //
    // IMPORTANT: We removed the <Redirect> that was causing duplicate messages!
    // The redirect was firing after human answered, causing the function to be
    // invoked again and play the message a second time.
    const twimlXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}" language="${language}">${screeningResponse}</Say>
  <Start>
    <Transcription 
      track="inbound_track" 
      transcriptionEngine="google" 
      speechModel="telephony"
      partialResults="true"
      statusCallbackUrl="https://${context.DOMAIN_NAME}/ios26_CallScreeningDetection_Transcriptions"
      name="post-ios26-monitoring"
    />
  </Start>
  <Pause length="300"/>
</Response>`;
    
    console.log(`📞 Sending iOS 26 response to call ${callSid}`);
    try {
      await client.calls(callSid).update({ twiml: twimlXml });
      console.log(`✅ iOS 26 response sent successfully`);
      console.log(`🚨🚨🚨 playIOS26Response() COMPLETED for call ${callSid} 🚨🚨🚨`);
      return 'SUCCESS';
    } catch (updateError) {
      // If update fails, it might be because another invocation already updated it
      // OR because the call is being modified simultaneously
      console.log(`⚠️ Call update failed: ${updateError.message}`);
      console.log(`⚠️ Error code: ${updateError.code}`);
      
      if (updateError.code === 20001 || 
          updateError.message.includes('not be modified') ||
          updateError.message.includes('cannot be updated') ||
          updateError.message.includes('already')) {
        console.log(`✅ This is OK - another webhook likely already updated the call`);
        return 'ABORTED';
      }
      
      // Re-throw if it's a different error
      console.error(`❌ Unexpected error updating call:`, updateError);
      throw updateError;
    }
    
  } catch (error) {
    console.error('❌ Error in playIOS26Response:', error);
    console.error('❌ Error details:', error.message);
  }
}

/**
 * Leave voicemail message (SCENARIO 1 & 4)
 * 
 * PURPOSE:
 * When we've detected voicemail (either after iOS 26 screening or directly),
 * leave our message after the beep.
 * 
 * TWO SCENARIOS:
 * - SCENARIO 1: iOS 26 screened, then voicemail (we've already played identification)
 * - SCENARIO 4: Direct voicemail, no iOS 26 (we're leaving message cold)
 * 
 * THE PAUSE:
 * Voicemail systems play a "beep" before recording. The 3-second pause gives
 * time for the beep to finish before we start speaking. Otherwise, our first
 * few words might get cut off!
 * 
 * VOICEMAIL MESSAGE STRUCTURE:
 * 1. Pause 3 seconds (wait for beep)
 * 2. Say the voicemail message
 * 3. Pause 2 seconds (give a clean ending)
 * 4. Hangup (we're done!)
 * 
 * WHY HANGUP?
 * After leaving the message, there's nothing left to do. We hang up cleanly
 * rather than staying connected (which would record silence and waste time).
 * 
 * @param {string} callSid - The Call SID to update
 * @param {object} context - Twilio function context
 * @param {string} voicemailMessage - The message to leave on voicemail
 */
async function leaveVoicemailMessage(callSid, context, voicemailMessage) {
  try {
    const client = context.getTwilioClient();
    
    // CRITICAL: Stop transcription BEFORE leaving voicemail message
    // Otherwise transcription picks up our OWN message being played and tries to process it!
    //
    // TIMING STRATEGY:
    // Voicemail systems typically have a greeting (5-10 seconds) + beep (1 second).
    // We need to wait for ALL of this to finish before speaking our message.
    // The 10-second pause gives time for even long greetings to complete.
    //
    // We use raw XML here because VoiceResponse SDK doesn't have a clean way to add
    // Stop commands. We manually construct the XML and properly escape the message.
    
    // Escape XML special characters in the voicemail message
    const escapedMessage = voicemailMessage
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
    
    const voicemailTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stop>
    <Transcription name="ios26-full-detection"/>
    <Transcription name="post-ios26-monitoring"/>
  </Stop>
  <Pause length="10"/>
  <Say voice="${context.TWILIO_VOICE || 'alice'}" language="${context.TWILIO_LANGUAGE || 'en-US'}">${escapedMessage}</Say>
  <Pause length="2"/>
</Response>`;
    
    console.log(`📞 Leaving voicemail for call ${callSid} (stopping transcription first)`);
    console.log(`📝 Voicemail TwiML being sent (with 10s pause for greeting):`);
    console.log(voicemailTwiml);
    
    await client.calls(callSid).update({ twiml: voicemailTwiml });
    console.log(`✅ Voicemail TwiML update sent successfully`);
    
  } catch (error) {
    console.error('❌ Error leaving voicemail:', error);
    console.error('❌ Error details:', error.message);
  }
}

/**
 * Stop transcription and pass through call (SCENARIO 2 & 3)
 * 
 * PURPOSE:
 * When a human is detected, STOP monitoring/transcription and let the call
 * continue naturally. This is the "success" case - we connected to a real person!
 * 
 * TWO SCENARIOS:
 * - SCENARIO 2: iOS 26 accepted us, human picked up
 * - SCENARIO 3: Direct human answer, no iOS 26
 * 
 * WHY <Stop><Transcription>?
 * We need to explicitly STOP the transcription that's running. If we don't,
 * transcription keeps running in the background, processing every word the
 * human says. That's:
 * 1. A privacy issue (we're recording their conversation)
 * 2. A cost issue (transcription costs money per second)
 * 3. Unnecessary (we've already made our decision)
 * 
 * WHY <Pause> FOR 300 SECONDS?
 * After stopping transcription, the call needs to continue (the humans are talking!).
 * The 300-second pause (5 minutes) is a placeholder - it keeps the call alive
 * while the conversation happens. The call will naturally end when someone hangs up.
 * 
 * WHAT ABOUT OUR CALLER?
 * Remember: We placed an outbound call, and now we're connecting the recipient
 * back to the original caller. Twilio handles this automatically - the two
 * parties can now talk freely!
 * 
 * @param {string} callSid - The Call SID to update
 * @param {object} context - Twilio function context
 */
async function stopTranscriptionAndPassthrough(callSid, context) {
  try {
    const client = context.getTwilioClient();
    
    console.log(`📞 Stopping transcription and passing through call ${callSid}`);
    
    // Use TwiML with <Stop> to explicitly stop transcription
    // We stop BOTH transcription streams (initial and post-iOS26) to be thorough
    const stopTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stop>
    <Transcription name="ios26-full-detection"/>
    <Transcription name="post-ios26-monitoring"/>
  </Stop>
  <Pause length="300"/>
</Response>`;
    
    console.log(`� Sending Stop transcription TwiML`);
    await client.calls(callSid).update({ twiml: stopTwiml });
    console.log(`✅ Transcription stop command sent, call continuing`);
    
  } catch (error) {
    console.error('❌ Error stopping transcription:', error);
    console.error('❌ Error details:', error.message);
  }
}

// ============================================================================
// TESTING HELPERS
// ============================================================================
//
// These exports make internal functions available for unit testing.
// In production, we only export the main handler. In testing, we export
// the pattern detection functions so we can test them in isolation.
//
// WHY TEST EXPORTS?
// Pattern detection is complex logic that needs thorough testing. By exporting
// these functions, we can write unit tests that verify each pattern matches
// correctly without having to create full Twilio calls.
//
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports._test = {
    detectIOS26Patterns,
    detectIntermediatePrompts,
    detectVoicemailPatterns,
    detectHumanSpeech,
    resetState: () => {
      callStates.clear();
      callTranscripts.clear();
      callStartTimes.clear();
      amdResults.clear();
      processedActions.clear();
    }
  };
}
