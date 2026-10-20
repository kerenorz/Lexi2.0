// Embed snippets researchers paste verbatim into their survey (assembled into the kit by
// embedKitDoc.ts). Kept free of React so they can be tested as built strings.

// The chat URL; identical on every chat page except the block number in the query.
export const chatUrlFor = (baseUrl: string, experimentId: string): string => `${baseUrl}/e/${experimentId}/s`;

// Shared with embedKitDoc.ts so the snippets and the kit's field lists can't drift.
// PID_PIPE keeps its backslash: without it JavaScript interpolates the Qualtrics pipe away and
// every participant shares one empty id.
export const FINISH_PATH = '/conversations/segments/finish';
export const ANSWERS_PATH = '/conversations/segments/answers';
export const PID_PIPE = '\${e://Field/ResponseID}';

// How long the host waits for any message from the chat: long enough for a slow phone load,
// short enough that the participant doesn't give up.
export const WATCHDOG_MS = 20000;

// The survey-question snippet. Hiding Next enforces the quota; `canProceed` (not isOpen) releases
// a block with a minimum; the watchdog shows Next even if the frame never runs.
// Without `block`, the snippet asks the researcher to edit the number; the kit passes it instead.
export const surveySnippet = (baseUrl: string, experimentId: string, block?: number): string =>
    `Qualtrics.SurveyEngine.addOnload(function () {
  var page = this;
  page.hideNextButton();

  // ${PID_PIPE} is Qualtrics' own participant id. Any stable, unguessable
  // per-participant id works — it is what ties every block to the same conversation.
  var pid = "${PID_PIPE}";
  ${
      block === undefined
          ? 'var block = 1;  // <-- CHANGE THIS on each chat page: 1, 2, 3 ...'
          : `var block = ${block};  // this is chat page ${block}, and this line is the only difference between pages`
  }

  var frame = document.createElement("iframe");
  frame.src = "${chatUrlFor(baseUrl, experimentId)}?pid=" + encodeURIComponent(pid) + "&segment=" + block;
  frame.style.width = "100%";
  frame.style.height = "min(70vh, 600px)";
  frame.style.border = "1px solid #ddd";
  frame.style.borderRadius = "8px";
  frame.allow = "microphone; camera";
  page.getQuestionContainer().appendChild(frame);

  // If the chat never loads — a campus or corporate network blocking the domain, an
  // extension blocking third-party frames, the app failing before it says anything — no
  // message ever arrives, and every line below that reveals Next is waiting for one. This
  // is the way out: show Next anyway and mark the response, so a participant is never
  // trapped on a page they cannot leave.
  var watchdog = setTimeout(function () {
    Qualtrics.SurveyEngine.setEmbeddedData("lexi_error", "no_response");
    page.showNextButton();
  }, ${WATCHDOG_MS});

  window.addEventListener("message", function (event) {
    var d = event.data;
    if (!d || d.source !== "lexi") return;
    // The chat is alive, so the watchdog is off — but only for a message that is OURS.
    // Another widget on the page must not be able to call it off on the chat's behalf.
    clearTimeout(watchdog);

    if (d.type === "error") {
      // The chat could not run. Release the participant rather than trapping them, and
      // record why so this response can be identified in your analysis.
      Qualtrics.SurveyEngine.setEmbeddedData("lexi_error", d.reason || "unknown");
      page.showNextButton();
      return;
    }

    if (d.canProceed) page.showNextButton();
    // Completion, for the studies this page can actually see it happen in: a final block
    // with a ceiling closes WHILE the participant is still sitting here, so the close
    // arrives as a message and is recorded.
    //
    // IT DOES NOT COVER THE BLANK-QUOTA STUDY, which is the recommended one. There the last
    // block is closed by the finish web service, which runs after this page — this frame is
    // gone by then and can never be told. So this branch is a bonus, not the mechanism:
    // FINISH_HINT tells the researcher to record the flag from the web service's own
    // response, which works either way. See tests/client/embed-kit.test.ts, which pins both
    // halves of that.
    if (d.isFinal && d.isOpen === false) {
      Qualtrics.SurveyEngine.setEmbeddedData("lexi_complete", "1");
    }
  });
});`;

// Breaks between blocks. Zero hides the answers snippet.
export const gapCount = (blocks: number): number => Math.max(0, (Number(blocks) || 0) - 1);

// One snippet per gap with the number filled in; a reused gap number is silently rejected as a duplicate.
export const answersSnippet = (baseUrl: string, experimentId: string, gap: number): string =>
    `POST ${baseUrl}${ANSWERS_PATH}
Content-Type: application/json

{
  "experimentId": "${experimentId}",
  "pid": "${PID_PIPE}",
  "gap": ${gap},
  "values": { "mood": "\${q://QID1/ChoiceTextEntryValue}" }
}`;

// Finish call: nothing else closes the last block, so without it finished runs look abandoned
// and never free their session. A survey-flow web service, since a request from the frame races
// page teardown. Idempotent; place it anywhere after the last chat block.
export const finishSnippet = (baseUrl: string, experimentId: string): string =>
    `POST ${baseUrl}${FINISH_PATH}
Content-Type: application/json

{
  "experimentId": "${experimentId}",
  "pid": "\${e://Field/ResponseID}"
}`;

// Hints are the only way to tell the researcher about requirements outside the pasted code,
// such as the finish call, which the chat cannot detect is missing.

export const CHAT_URL_HINT =
    'Add ?pid=<participant id>&segment=<block number>. The participant id must be stable across the whole survey and unguessable.';

export const SURVEY_JS_HINT =
    'Add to each question that hosts the chat, changing the block number on each one. It hides your Next button ' +
    'until the block is finished, and reveals it anyway if the chat never loads.';

export const FINISH_HINT =
    'REQUIRED. Add as a web service in your survey flow, after the last chat page. This is what tells the study a ' +
    'participant finished — there is no chat page after the last one to end it, so without this call every completed ' +
    'run looks abandoned in your export and its place in the study is never given back. ' +
    'To flag completion in your SURVEY data too, use this element’s "Set Embedded Data" to save the response’s ' +
    '"finished" field as lexi_complete. Read it there, not from the chat page: by the time this call runs the chat ' +
    'frame is gone, so nothing on that page can know the study ended.';

export const answersHint = (gaps: number): string =>
    `One web-service call per break, ${gaps} in total. The gap number is already filled in — use the matching one after each block, and replace the values with your own question IDs.`;
