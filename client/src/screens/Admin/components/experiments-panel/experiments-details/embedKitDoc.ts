import {
    ANSWERS_PATH,
    FINISH_PATH,
    PID_PIPE,
    WATCHDOG_MS,
    chatUrlFor,
    gapCount,
    surveySnippet,
} from './embedSnippet';

// Per-experiment Qualtrics setup guide as a plain .txt download. Plain text so pasted code can't
// pick up smart quotes. The verbatim snippets live in embedSnippet.ts; this builds the prose
// around them and reuses its constants so the two can't drift.

export interface EmbedKitInput {
    title: string;
    experimentId: string;
    baseUrl: string;
    blocks: number;
    // Passed in to keep this module deterministic.
    generatedAt: Date;
}

const RULE = '='.repeat(78);
const THIN = '-'.repeat(78);

// A Qualtrics Web Service body row. `gap` must be String (Number fails validation); `values`
// must be JSON, the only type that sends a nested object.
interface Field {
    name: string;
    type: 'String' | 'JSON';
    value: string;
}

const fieldTable = (fields: Field[]): string => {
    const nameWidth = Math.max(...fields.map((f) => f.name.length), 'Field'.length);
    const typeWidth = Math.max(...fields.map((f) => f.type.length), 'Type'.length);
    const row = (name: string, type: string, value: string) =>
        `     ${name.padEnd(nameWidth)}   ${type.padEnd(typeWidth)}   ${value}`;
    return [
        row('Field', 'Type', 'Value'),
        row('-'.repeat(nameWidth), '-'.repeat(typeWidth), '-'.repeat(20)),
        ...fields.map((f) => row(f.name, f.type, f.value)),
    ].join('\n');
};

const section = (title: string): string => [THIN, ` ${title}`, THIN].join('\n');

// Text diagram of the survey's pages, from the block count.
const surveyMap = (blocks: number): string => {
    // Fixed column so the notes line up.
    const NOTE_COLUMN = 26;
    const line = (label: string, note = '') => `   ${(label.padEnd(NOTE_COLUMN) + note).trimEnd()}`;

    const rows: string[] = [line('[ your own questions ]')];
    for (let block = 1; block <= blocks; block++) {
        rows.push(
            line(
                `[ CHAT PAGE ${block} ]`,
                block === 1 ? '<- Lexi chat, block 1' : `<- block ${block}, the same conversation continued`,
            ),
        );
        if (block < blocks) rows.push(line('[ your own questions ]', `<- break ${block}`));
    }
    rows.push(line('[ your own questions ]'));
    rows.push(line('[ FINISH web service ]', '<- required, STEP 2'));
    return rows.join('\n');
};

export const buildEmbedKitDoc = ({ title, experimentId, baseUrl, blocks, generatedAt }: EmbedKitInput): string => {
    const gaps = gapCount(blocks);
    const chatUrl = chatUrlFor(baseUrl, experimentId);
    const generated = generatedAt.toISOString().slice(0, 10);

    const parts: string[] = [];

    parts.push(
        [
            RULE,
            '  LEXI  +  QUALTRICS      SURVEY EMBED KIT',
            RULE,
            '',
            `  Experiment      ${title}`,
            `  Experiment ID   ${experimentId}`,
            `  Chat blocks     ${blocks}`,
            `  Breaks          ${gaps}   (a break is where your survey asks its own questions)`,
            `  Generated       ${generated}`,
            '',
            '  Everything below is already filled in for THIS experiment. You should not',
            '  need to type an id or a web address by hand anywhere in this file.',
        ].join('\n'),
    );

    parts.push(
        [
            section('WHAT YOU ARE BUILDING'),
            '',
            surveyMap(blocks),
            '',
            `  For the participant this is ONE conversation, cut into ${blocks} ${blocks === 1 ? 'block' : 'blocks'}.`,
            '  Between blocks the agents wait; nothing restarts and nothing is lost. When',
            '  the participant comes back, the chat is exactly where they left it.',
        ].join('\n'),
    );

    parts.push(
        [
            section('BEFORE YOU START'),
            '',
            '  * You need a licensed Qualtrics account. Adding JavaScript to a question is',
            '    not available on a free one.',
            '  * STEP 1 and STEP 2 are required. STEP 3 is optional.',
            '  * When you test the survey yourself, be LOGGED OUT of Lexi in that browser.',
            '    A logged-in researcher is treated as a preview: the chat opens, but no',
            '    participant is ever registered and the calls in STEP 2 and STEP 3 will',
            '    answer "USER_NOT_FOUND". Use a different browser, or log out first.',
            '  * The first time a participant reaches the chat, Lexi asks them to register,',
            '    inside the survey page. The name they choose there is the name the agents',
            '    will use. Their Qualtrics response id is kept alongside it, so your survey',
            '    data and your chat data still join up.',
        ].join('\n'),
    );

    parts.push(
        [
            section(`STEP 1 - THE CHAT PAGES     (required, ${blocks} ${blocks === 1 ? 'page' : 'pages'})`),
            '',
            `  Create ${blocks} ${blocks === 1 ? 'question' : 'questions'} in your survey, one per chat page. A Text / Graphic`,
            '  question is the usual choice, and it needs no text of its own.',
            '',
            '  On each one:',
            '',
            '    1. Click the question, then JavaScript in the panel on the left.',
            '    2. Delete everything already in the editor.',
            '    3. Paste the block below that matches that page.',
            '',
            '  This code hides your Next button until the participant is allowed to move on,',
            `  and reveals it by itself if the chat has not loaded within ${Math.round(WATCHDOG_MS / 1000)} seconds, so`,
            '  nobody can be trapped on the page.',
            '',
            '  The chat address is the same on every page:',
            '',
            `      ${chatUrl}`,
            '',
            '  Only the block number differs, and it is already set for you below.',
        ].join('\n'),
    );

    for (let block = 1; block <= blocks; block++) {
        parts.push(
            [
                `  - - - - -  CHAT PAGE ${block} OF ${blocks}  - - - - -`,
                '',
                surveySnippet(baseUrl, experimentId, block),
            ].join('\n'),
        );
    }

    parts.push(
        [
            section('STEP 2 - TELLING LEXI THE PARTICIPANT FINISHED     (required)'),
            '',
            '  WHY THIS IS NOT OPTIONAL. A chat block is closed when the participant arrives',
            '  at the NEXT chat page. The last chat page has no next page, so without this',
            '  call the last block never closes: every participant who finished is exported',
            '  as though they abandoned the study, and their place in it is never given',
            '  back, until a study that is not full stops letting anyone in.',
            '',
            '  In Qualtrics: Survey flow -> Add a New Element Here -> Web Service.',
            '  Drag it to sit AFTER your last chat page. Anywhere later is fine too.',
            '',
            `     URL            ${baseUrl}${FINISH_PATH}`,
            '     Method         POST',
            '     Content type   application/json',
            '',
            '  Set the content type FIRST. The rows for the fields below only appear once',
            '  the method is POST and the type is JSON - before that the element offers you',
            '  a different kind of form entirely.',
            '',
            fieldTable([
                { name: 'experimentId', type: 'String', value: experimentId },
                { name: 'pid', type: 'String', value: PID_PIPE },
            ]),
            '',
            '  Then, in the SAME element, open "Set Embedded Data" and add one line:',
            '',
            '     lexi_complete   =   finished',
            '',
            '  That is what marks the response as a completed chat in your SURVEY data. It',
            '  has to be read here, from this call\'s own answer, and not on the chat page:',
            '  by the time this runs, the last chat page is behind the participant and the',
            '  chat is gone from the screen, so nothing there can be told the study ended.',
            '',
            '  The call is safe to make twice. A second one finds nothing left open and',
            '  says so, rather than changing anything.',
        ].join('\n'),
    );

    if (gaps > 0) {
        parts.push(
            [
                section(`STEP 3 - SENDING SURVEY ANSWERS TO THE AGENTS     (optional, ${gaps} ${gaps === 1 ? 'break' : 'breaks'})`),
                '',
                '  You can hand the agents what the participant answered during a break, so',
                '  that when the chat resumes they simply know it. There is no "the survey',
                '  told me" - it arrives as something the agent has always known.',
                '',
                '  The SENTENCE the agents are told is written in Lexi, in the experiment\'s',
                '  survey panel, with {{placeholders}} in it. What you send here only fills',
                '  those placeholders in. A sentence whose placeholders go unanswered is',
                '  dropped whole rather than said with a gap in it.',
                '',
                `  One web service per break, ${gaps} in total, each placed AFTER the questions of`,
                '  that break. Same element type as STEP 2:',
                '',
                `     URL            ${baseUrl}${ANSWERS_PATH}`,
                '     Method         POST',
                '     Content type   application/json',
            ].join('\n'),
        );

        for (let gap = 1; gap <= gaps; gap++) {
            parts.push(
                [
                    `  - - - - -  BREAK ${gap} OF ${gaps}  (between chat page ${gap} and chat page ${gap + 1})  - - - - -`,
                    '',
                    fieldTable([
                        { name: 'experimentId', type: 'String', value: experimentId },
                        { name: 'pid', type: 'String', value: PID_PIPE },
                        { name: 'gap', type: 'String', value: String(gap) },
                        {
                            name: 'values',
                            type: 'JSON',
                            // Not a template literal: Qualtrics piping uses ${...} too.
                            value: '{"mood": "${q://QID1/ChoiceGroup/SelectedChoices}"}',
                        },
                    ]),
                ].join('\n'),
            );
        }

        parts.push(
            [
                '  TWO THINGS IN THAT TABLE THAT LOOK WRONG AND ARE NOT:',
                '',
                '  * "gap" is a String, even though it is a number. The Number type refuses',
                '    to validate here and will not let you save the element. Lexi reads it',
                '    as a number either way.',
                '  * "values" is the type JSON, not String. It is the only type that sends a',
                '    nested answer, which is the shape this call expects. Each row inside it',
                '    is one of your {{placeholders}} and the question that fills it.',
                '',
                '  Replace QID1 with your own question id - Qualtrics shows it beside each',
                '  question - and add a line inside "values" for every placeholder you want',
                '  filled. The gap number is already correct in each table above; sending the',
                '  same gap twice is refused as a duplicate, and those agents learn nothing.',
            ].join('\n'),
        );
    } else {
        parts.push(
            [
                section('STEP 3 - SENDING SURVEY ANSWERS TO THE AGENTS     (not applicable)'),
                '',
                '  This study has one chat block, so it has no break between blocks for the',
                '  survey to collect answers in. If you add more blocks in Lexi, download',
                '  this kit again and this step will be filled in.',
            ].join('\n'),
        );
    }

    parts.push(
        [
            section('BEFORE YOU LAUNCH - CHECK EACH OF THESE'),
            '',
            `  [ ] ${blocks} chat ${blocks === 1 ? 'page' : 'pages'}, each with its own block of JavaScript from STEP 1.`,
            '  [ ] Each page has a DIFFERENT block number, in order, none repeated.',
            '  [ ] The finish web service from STEP 2 is in the survey flow, after the last',
            '      chat page, with lexi_complete mapped to finished.',
            gaps > 0
                ? `  [ ] ${gaps} answer ${gaps === 1 ? 'call' : 'calls'} from STEP 3, if you are using them, one per break and`
                : '  [ ] (no answer calls - this study has no breaks)',
            gaps > 0 ? '      each with the gap number it was given here.' : '',
            '  [ ] You have run the survey once yourself, LOGGED OUT of Lexi, and seen the',
            '      chat register you, the Next button appear, and the second page resume the',
            '      same conversation.',
            '  [ ] That test run shows up in Lexi under "Download My Pilot Runs".',
        ]
            .filter((line) => line !== '')
            .join('\n'),
    );

    parts.push(
        [
            section('IF SOMETHING GOES WRONG'),
            '',
            '  The Next button never appears.',
            '      Most often the participant switched to another tab. Browsers slow down a',
            '      background tab, and the chat page checks in every 20 seconds, so the',
            '      button can take minutes to appear until the tab is in front again. If it',
            '      is in front and still hidden, the block has a minimum the participant has',
            '      not met yet - check the study\'s survey panel in Lexi.',
            '',
            '  The Next button appears but the chat never loaded.',
            `      That is the ${Math.round(WATCHDOG_MS / 1000)}-second safety net, and the response carries`,
            '      lexi_error = no_response. It usually means the network the participant is',
            '      on blocks the chat address, or their browser blocks embedded pages.',
            '',
            '  A web service answers USER_NOT_FOUND.',
            '      You were logged into Lexi as a researcher in the browser you tested with,',
            '      so the visit counted as a preview and no participant was registered. Log',
            '      out and run it again.',
            '',
            '  Runs show as abandoned in the export even though people finished.',
            '      The finish web service in STEP 2 is missing, or it sits somewhere the',
            '      participant does not reach.',
            '',
            '  Everyone appears to be in the same conversation.',
            '      The participant id is not reaching Lexi. Check that the pid line in the',
            '      JavaScript still reads exactly as it does in STEP 1 - if the ${...} part',
            '      was edited or lost, every participant arrives with the same empty id.',
            '',
            RULE,
            `  Generated by Lexi on ${generated} for "${title}".`,
            '  If you change the number of chat blocks, download this kit again.',
            RULE,
        ].join('\n'),
    );

    return parts.join('\n\n') + '\n';
};

// Replace characters Windows refuses in filenames (e.g. a "/" in the title).
export const embedKitFilename = (title: string): string => {
    const safe = (title || 'experiment').replace(/[\\/:*?"<>|]/g, '-').trim() || 'experiment';
    return `${safe} Qualtrics Embed Kit.txt`;
};
