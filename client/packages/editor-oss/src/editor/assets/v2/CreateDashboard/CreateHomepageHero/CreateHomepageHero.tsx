import {lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {HiOutlineCube, HiOutlineKey, HiOutlineSparkles} from "react-icons/hi2";
import {useNavigate} from "react-router-dom";

import {
    CharacterCount,
    ExampleButton,
    ExampleRow,
    GenerateButton,
    Heading,
    CreateHomepageHeroWrapper,
    KeyConfigButton,
    KeyConfigRow,
    PromptCard,
    PromptHeader,
    PromptInputArea,
    PromptError,
    PromptTextarea,
    ScratchButton,
    StatsRow,
} from "./CreateHomepageHero.style";
import {getHomepageContent, HomepageSuggestion} from "@stem/network/api/homepage";
import {ROUTES} from "@web-shared/routes";
import {isPlaygroundMode} from "@web-shared/playgroundMode";
import {PRODUCT_ANALYTICS_EVENTS, trackProductEvent} from "@stem/editor-oss/utils/productAnalytics";
import {hasCopilotKeysSync} from "../../../../../copilot/playgroundCopilotKeyMarker";
import {refreshCopilotKeysMarker} from "../../../../../copilot/playgroundCopilotKeys";
import {savePickerPrompt} from "../CreateDashboardView/baseGamePickerStorage";

const AiKeysModal = lazy(() => import("../../AiCopilot/AiKeysModal").then(module => ({default: module.AiKeysModal})));

const DEFAULT_SUGGESTIONS: HomepageSuggestion[] = [
    {
        id: "island-survival",
        label: "Island Survival",
        prompt: "A cozy island survival game with trading NPCs and co-op quests.",
    },
    {
        id: "dungeon-crawler",
        label: "Dungeon Crawler",
        prompt: "A dungeon crawler with traps, keys, treasure rooms, and a boss encounter.",
    },
    {
        id: "robot-factory",
        label: "Robot Factory",
        prompt: "A robot factory automation game with conveyor belts, upgrades, and hazards.",
    },
    {
        id: "mystery-adventure",
        label: "Mystery Adventure",
        prompt: "A mystery adventure in a foggy town with clues, puzzles, and branching dialogue.",
    },
];
const DEFAULT_PLACEHOLDER = "A cozy island survival game with trading NPCs and co-op quests.";
const PROMPT_REQUIRED_ERROR = "Please describe the game you want to create before we start.";
const PROMPT_INPUT_ID = "home-prompt-input";
const PROMPT_ERROR_ID = "home-prompt-error";
const PROMPT_WORD_LIMIT = 16000;
const PROMPT_MIN_VISIBLE_LINES = 4;
const PROMPT_MAX_AUTO_VISIBLE_LINES = 7;
const PROMPT_AUTO_HEIGHT_DATA_KEY = "promptAutoHeight";

const formatCount = (value: number) => new Intl.NumberFormat("en-US").format(Math.max(0, value));

const suggestionTestId = (suggestion: HomepageSuggestion) =>
    `home-example-${(suggestion.id || suggestion.label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

const countPromptWords = (value: string) => value.match(/\S+/g)?.length ?? 0;

const clampPromptToWordLimit = (value: string) => {
    let wordCount = 0;
    let match: RegExpExecArray | null;
    const matcher = /\S+/g;

    while ((match = matcher.exec(value)) !== null) {
        wordCount += 1;
        if (wordCount > PROMPT_WORD_LIMIT) {
            return value.slice(0, match.index).trimEnd();
        }
    }

    return value;
};

const parseCssPixels = (value: string) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const getPromptTextareaMetrics = (textarea: HTMLTextAreaElement) => {
    const styles = window.getComputedStyle(textarea);
    const fontSize = parseCssPixels(styles.fontSize) || 16;
    const lineHeight =
        styles.lineHeight === "normal" ? fontSize * 1.5 : parseCssPixels(styles.lineHeight) || fontSize * 1.5;
    const paddingY = parseCssPixels(styles.paddingTop) + parseCssPixels(styles.paddingBottom);
    const borderY = parseCssPixels(styles.borderTopWidth) + parseCssPixels(styles.borderBottomWidth);

    return {
        borderY,
        minHeight: PROMPT_MIN_VISIBLE_LINES * lineHeight + paddingY + borderY,
        maxAutoHeight: PROMPT_MAX_AUTO_VISIBLE_LINES * lineHeight + paddingY + borderY,
    };
};

const resizePromptTextarea = (textarea: HTMLTextAreaElement) => {
    const {borderY, minHeight, maxAutoHeight} = getPromptTextareaMetrics(textarea);
    const currentHeight = textarea.getBoundingClientRect().height;
    const previousAutoHeight = Number.parseFloat(textarea.dataset[PROMPT_AUTO_HEIGHT_DATA_KEY] || "");

    if (Number.isFinite(previousAutoHeight) && Math.abs(currentHeight - previousAutoHeight) > 1) {
        textarea.style.overflowY = "auto";
        return;
    }

    textarea.style.height = `${minHeight}px`;
    const contentHeight = textarea.scrollHeight + borderY;
    const nextHeight = Math.min(Math.max(contentHeight, minHeight), maxAutoHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.dataset[PROMPT_AUTO_HEIGHT_DATA_KEY] = String(nextHeight);
    textarea.style.overflowY = contentHeight > maxAutoHeight ? "auto" : "hidden";
};

type CreateHomepageHeroProps = {
    onPromptSubmit?: (prompt: string) => void;
    onScratchStart?: () => void;
    isBusy?: boolean;
};

export const CreateHomepageHero = ({onPromptSubmit, onScratchStart, isBusy = false}: CreateHomepageHeroProps) => {
    const navigate = useNavigate();
    const promptInputRef = useRef<HTMLTextAreaElement>(null);
    const [prompt, setPrompt] = useState("");
    const [promptError, setPromptError] = useState("");
    const [gamesCreated, setGamesCreated] = useState<number | null>(null);
    const [suggestions, setSuggestions] = useState<HomepageSuggestion[]>(DEFAULT_SUGGESTIONS);
    const promptWordCount = useMemo(() => countPromptWords(prompt), [prompt]);

    // Playground mode has no Go AI server: AI game creation runs browser-direct
    // against the visitor's own provider key. Surface key config here so the
    // visitor can set a key before submitting a prompt. Outside the playground
    // the dashboard Settings page already hosts the BYOK panel.
    const isPlayground = isPlaygroundMode();
    const [isKeysOpen, setIsKeysOpen] = useState(false);
    const [hasKeys, setHasKeys] = useState(() => isPlaygroundMode() && hasCopilotKeysSync());

    useEffect(() => {
        let cancelled = false;
        void getHomepageContent()
            .then(content => {
                if (cancelled) return;
                setGamesCreated(content.gamesCreated);
                const nextSuggestions = Array.isArray(content.suggestions)
                    ? content.suggestions.filter(suggestion => suggestion.label && suggestion.prompt)
                    : [];
                if (nextSuggestions.length > 0) {
                    setSuggestions(nextSuggestions);
                }
            })
            .catch(error => {
                console.warn("Failed to load homepage content", error);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const placeholder = useMemo(() => suggestions[0]?.prompt || DEFAULT_PLACEHOLDER, [suggestions]);

    useLayoutEffect(() => {
        if (promptInputRef.current) {
            resizePromptTextarea(promptInputRef.current);
        }
    }, [prompt]);

    useEffect(() => {
        const handleResize = () => {
            if (promptInputRef.current) {
                resizePromptTextarea(promptInputRef.current);
            }
        };

        window.addEventListener("resize", handleResize);
        return () => {
            window.removeEventListener("resize", handleResize);
        };
    }, []);

    const handlePromptChange = (nextPrompt: string) => {
        const limitedPrompt = clampPromptToWordLimit(nextPrompt);
        setPrompt(limitedPrompt);
        if (promptError && limitedPrompt.trim()) {
            setPromptError("");
        }
    };

    const beginAuthFlow = (nextPrompt?: string, source: "generate" | "scratch" = "generate") => {
        const trimmed = nextPrompt?.trim() || "";
        trackProductEvent(
            source === "generate"
                ? PRODUCT_ANALYTICS_EVENTS.HOME_PROMPT_SUBMITTED
                : PRODUCT_ANALYTICS_EVENTS.START_FROM_SCRATCH_CLICKED,
            {
                prompt_length: trimmed.length,
                has_prompt: trimmed.length > 0,
            },
        );
        if (source === "generate" && onPromptSubmit) {
            onPromptSubmit(trimmed);
            return;
        }
        if (source === "scratch" && onScratchStart) {
            onScratchStart();
            return;
        }
        if (trimmed) {
            savePickerPrompt(trimmed, {autoStart: true});
        }
        void navigate(ROUTES.LOGIN, {state: {from: ROUTES.HOME}});
    };

    const handleKeysClose = () => {
        setIsKeysOpen(false);
        void refreshCopilotKeysMarker().then(ready => setHasKeys(ready));
    };

    const handleGenerateSubmit = () => {
        const trimmed = prompt.trim();
        if (!trimmed) {
            setPromptError(PROMPT_REQUIRED_ERROR);
            promptInputRef.current?.focus();
            return;
        }

        setPromptError("");
        beginAuthFlow(trimmed, "generate");
    };

    return (
        <CreateHomepageHeroWrapper>
            <Heading>Bring your idea to life</Heading>
            <StatsRow>
                <span />
                <HiOutlineCube />
                <strong>{formatCount(gamesCreated ?? 0)}</strong>
                <span>Games Created</span>
                <span />
            </StatsRow>

            <PromptCard
                onSubmit={event => {
                    event.preventDefault();
                    handleGenerateSubmit();
                }}
            >
                <PromptHeader>
                    <HiOutlineSparkles />
                    <span>Describe the game you want to create</span>
                </PromptHeader>
                {isPlayground && (
                    <KeyConfigRow $configured={hasKeys}>
                        <HiOutlineKey />
                        <span>
                            {hasKeys
                                ? "Your AI provider key is configured — generate away."
                                : "AI game creation works in the playground, but you bring your own AI provider key. Add one to start generating."}
                        </span>
                        <KeyConfigButton type="button" onClick={() => setIsKeysOpen(true)}>
                            {hasKeys ? "Manage keys" : "Set up keys"}
                        </KeyConfigButton>
                    </KeyConfigRow>
                )}
                <PromptInputArea>
                    <PromptTextarea
                        ref={promptInputRef}
                        id={PROMPT_INPUT_ID}
                        value={prompt}
                        onChange={event => handlePromptChange(event.target.value)}
                        placeholder={placeholder}
                        data-testid="home-prompt-input"
                        aria-invalid={Boolean(promptError)}
                        aria-describedby={promptError ? PROMPT_ERROR_ID : undefined}
                        $invalid={Boolean(promptError)}
                    />
                    <CharacterCount>
                        {formatCount(promptWordCount)}/{formatCount(PROMPT_WORD_LIMIT)} words
                    </CharacterCount>
                </PromptInputArea>
                {promptError ? (
                    <PromptError
                        id={PROMPT_ERROR_ID}
                        role="alert"
                        data-testid="home-prompt-error"
                    >
                        {promptError}
                    </PromptError>
                ) : null}
                <ExampleRow>
                    {suggestions.map(suggestion => (
                        <ExampleButton
                            key={suggestion.id || suggestion.label}
                            type="button"
                            onClick={() => {
                                trackProductEvent(PRODUCT_ANALYTICS_EVENTS.HOME_EXAMPLE_SELECTED, {
                                    example: suggestion.label,
                                });
                                setPrompt(clampPromptToWordLimit(suggestion.prompt));
                                setPromptError("");
                            }}
                            data-testid={suggestionTestId(suggestion)}
                        >
                            <HiOutlineSparkles />
                            {suggestion.label}
                        </ExampleButton>
                    ))}
                </ExampleRow>
                <GenerateButton
                    type="submit"
                    data-testid="home-generate-button"
                    disabled={isBusy}
                >
                    <HiOutlineSparkles />
                    Generate Game
                </GenerateButton>
                <ScratchButton
                    type="button"
                    onClick={() => {
                        setPromptError("");
                        beginAuthFlow(undefined, "scratch");
                    }}
                    data-testid="home-scratch-button"
                >
                    Start from scratch
                </ScratchButton>
            </PromptCard>
            {isKeysOpen && (
                <Suspense fallback={null}>
                    <AiKeysModal onClose={handleKeysClose} />
                </Suspense>
            )}
        </CreateHomepageHeroWrapper>
    );
};
