import { UserConfig, Options } from 'emmet';
import { extract, expand, getOutputOptions } from '../emmet';
import { getSyntaxType } from '../syntax';
import getAbbreviationContext, { ActivationContext } from './context';
import {
    handleChange, handleSelectionChange, allowTracking,
    startTracking, stopTracking, getTracker, Tracker
} from './tracker';
import { toRange } from '../utils';

interface EmmetCompletionAssistant extends CompletionAssistant {
    handleChange(editor: TextEditor): void;
    handleSelectionChange(editor: TextEditor): void;
}

type EmmetTracker = Tracker & ActivationContext & {
    options: Partial<Options>
};

const pairs = {
    '{': '}',
    '[': ']',
    '(': ')'
};

export default function createProvider(): EmmetCompletionAssistant {
    return {
        provideCompletionItems(editor, ctx) {
            const t = measureTime();
            const result: CompletionItem[] = [];
            let tracker = getTracker(editor) as EmmetTracker | undefined;
            console.log(`cmpl ${ctx.position}, reason ${ctx.reason}, has tracker? ${!!tracker}`);

            if (!tracker) {
                if (ctx.reason === CompletionReason.Invoke) {
                    // User forcibly requested completion popup
                    tracker = extractAbbreviationTracking(editor, ctx);
                    t.mark('Extract tracking');
                } else if (allowTracking(editor)) {
                    // Check if we should start abbreviation tracking
                    tracker = startAbbreviationTracking(editor, ctx);
                    t.mark('Start tracking');
                }
            }

            if (tracker) {
                // Validate abbreviation: show completion only if it’s a valid
                // abbreviation. If it’s invalid, check where caret was: if it’s
                // inside abbreviation then give user a chance to fix it, otherwise
                // most likely user don’t want Emmet abbreviation here
                const config = getConfig(editor, tracker);
                try {
                    result.push(createExpandAbbreviationCompletion(editor, tracker, config));
                    // TODO add snippet completions
                } catch (err) {
                    // Failed due to invalid abbreviation, decide what to do with
                    // tracker: dispose it if caret is at the abbreviation end
                    // or give user a chance to fix it
                    console.log('abbreviation is invalid');
                    if (ctx.position === tracker.range[1]) {
                        console.log('stop tracking');
                        stopTracking(editor);
                    }
                }

                t.mark('Create abbreviation completion');
            }

            console.log(t.dump());
            console.log('return items: ' + result.length);
            return result;
        },
        handleChange,
        handleSelectionChange
    };
}

/**
 * Check if we can start abbreviation tracking for given editor and completion context.
 * If tracking is allowed, returns initial abbreviation range
 */
function startAbbreviationTracking(editor: TextEditor, ctx: CompletionContext): EmmetTracker | undefined {
    // Start tracking only if user starts abbreviation typing: entered first
    // character at the word bound
    // NB: get last 2 characters: first should be a word bound (or empty),
    // second must be abbreviation start
    const prefix = ctx.line.slice(-2);
    const pos = ctx.position;

    if (/^[\s>]?[a-zA-Z.#\[\(]$/.test(prefix)) {
        const abbrCtx = getAbbreviationContext(editor, pos);
        if (abbrCtx) {
            let start = pos - 1;
            let end = pos;
            const lastCh = prefix.slice(-1);
            if (lastCh in pairs) {
                // Check if there’s paired character
                const nextCharRange = new Range(pos, Math.min(pos + 1, editor.document.length));
                if (editor.getTextInRange(nextCharRange) === pairs[lastCh]) {
                    end++;
                }
            }

            const tracker = startTracking(editor, start, end) as EmmetTracker;
            return Object.assign(tracker, abbrCtx, {
                options: getOutputOptions(editor, abbrCtx.inline)
            });
        }
    }
}

/**
 * If allowed, tries to extract abbreviation from given completion context
 */
function extractAbbreviationTracking(editor: TextEditor, ctx: CompletionContext): EmmetTracker | undefined {
    const pos = ctx.position;
    const abbrCtx = getAbbreviationContext(editor, pos);
    if (abbrCtx) {
        const config = getConfig(editor, abbrCtx);
        const abbr = extract(editor, pos, config);
        if (abbr) {
            const tracker = startTracking(editor, abbr.start, abbr.end) as EmmetTracker;
            return Object.assign(tracker, abbrCtx, {
                options: getOutputOptions(editor, abbrCtx.inline)
            });
        }
    }
}

function getConfig(editor: TextEditor, abbrCtx: ActivationContext): UserConfig {
    return {
        type: getSyntaxType(abbrCtx.syntax),
        syntax: abbrCtx.syntax,
        context: abbrCtx.context,
        options: getOutputOptions(editor, abbrCtx.inline)
    };
}

function getPreviewConfig(config: UserConfig): UserConfig {
    return {
        ...config,
        options: {
            ...config.options,
            'output.field': previewField,
            'output.indent': '  ',
            'output.baseIndent': ''
        }
    };
}

function previewField(index: number, placeholder: string) {
    return placeholder;
}

/**
 * Creates completion with expanded abbreviation, if possible
 */
function createExpandAbbreviationCompletion(editor: TextEditor, tracker: EmmetTracker, config: UserConfig): CompletionItem {
    const abbrRange = toRange(tracker.range);
    const abbr = editor.getTextInRange(abbrRange);
    console.log(`Expand "${abbr}"`);

    const snippet = expand(abbr, config);
    const preview = expand(abbr, getPreviewConfig(config));
    const completion = new CompletionItem(abbr, CompletionItemKind.Expression);
    completion.tokenize = true;
    completion.range = abbrRange;
    completion.insertText = snippet;
    completion.detail = 'Emmet';
    completion.documentation = preview;

    return completion;
}

function measureTime() {
    let time = Date.now();
    const start = time;
    const messages: string[] = [];

    return {
        mark(label: string) {
            const now = Date.now();
            messages.push(`${label}: ${now - time}ms`);
            time = now;
        },
        dump() {
            messages.push(`Total time: ${Date.now() - start}ms`);
            return messages.join('\n');
        }
    }
}
