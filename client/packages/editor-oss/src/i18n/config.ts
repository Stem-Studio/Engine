import i18n from "i18next";
import {initReactI18next} from "react-i18next";

import {translationAdditionsEn} from "./additionsEn";
import translationsEnglish from "./locales/en/translations.json";

const LANGUAGE_STORAGE_KEY = "stemstudio.language";
const supportedLanguages = ["en", "fr-FR", "ja-JP", "ko-KR", "ru-RU", "zh-CN", "zh-TW"] as const;
type SupportedLanguage = typeof supportedLanguages[number];
type TranslationMap = Record<string, string>;
const DEFAULT_NAMESPACE = "translations";

/**
 *
 * @param candidate
 */
function resolveLanguage(candidate?: string | null): SupportedLanguage {
    if (!candidate) return "en";
    if (supportedLanguages.includes(candidate as SupportedLanguage)) {
        return candidate as SupportedLanguage;
    }

    const lower = candidate.toLowerCase();
    if (lower.startsWith("fr")) return "fr-FR";
    if (lower.startsWith("ja")) return "ja-JP";
    if (lower.startsWith("ko")) return "ko-KR";
    if (lower.startsWith("ru")) return "ru-RU";
    if (lower.startsWith("zh-tw") || lower.startsWith("zh-hk")) return "zh-TW";
    if (lower.startsWith("zh")) return "zh-CN";
    return "en";
}

const initialLanguage = resolveLanguage(
    typeof window !== "undefined"
        ? window.localStorage.getItem(LANGUAGE_STORAGE_KEY) || window.navigator.language
        : "en",
);

const loadedLanguages = new Set<SupportedLanguage>(["en"]);
const languageResourceLoaders: Record<Exclude<SupportedLanguage, "en">, () => Promise<TranslationMap>> = {
    "fr-FR": async () => {
        const [{default: translations}, {translationAdditions}] = await Promise.all([
            import("./locales/fr-FR/translations.json"),
            import("./additions"),
        ]);
        return {...translations, ...translationAdditions["fr-FR"]};
    },
    "ja-JP": async () => {
        const [{default: translations}, {translationAdditions}] = await Promise.all([
            import("./locales/ja-JP/translations.json"),
            import("./additions"),
        ]);
        return {...translations, ...translationAdditions["ja-JP"]};
    },
    "ko-KR": async () => {
        const [{default: translations}, {translationAdditions}] = await Promise.all([
            import("./locales/ko-KR/translations.json"),
            import("./additions"),
        ]);
        return {...translations, ...translationAdditions["ko-KR"]};
    },
    "ru-RU": async () => {
        const [{default: translations}, {translationAdditions}] = await Promise.all([
            import("./locales/ru-RU/translations.json"),
            import("./additions"),
        ]);
        return {...translations, ...translationAdditions["ru-RU"]};
    },
    "zh-CN": async () => {
        const [{default: translations}, {translationAdditions}] = await Promise.all([
            import("./locales/zh-CN/translations.json"),
            import("./additions"),
        ]);
        return {...translations, ...translationAdditions["zh-CN"]};
    },
    "zh-TW": async () => {
        const [{default: translations}, {translationAdditions}] = await Promise.all([
            import("./locales/zh-TW/translations.json"),
            import("./additions"),
        ]);
        return {...translations, ...translationAdditions["zh-TW"]};
    },
};

async function ensureLanguageResources(language: string | null | undefined): Promise<SupportedLanguage> {
    const resolvedLanguage = resolveLanguage(language);
    if (loadedLanguages.has(resolvedLanguage)) {
        return resolvedLanguage;
    }

    const loader = languageResourceLoaders[resolvedLanguage as Exclude<SupportedLanguage, "en">];
    if (!loader) {
        return "en";
    }

    const resources = await loader();
    i18n.addResourceBundle(resolvedLanguage, DEFAULT_NAMESPACE, resources, true, true);
    loadedLanguages.add(resolvedLanguage);
    return resolvedLanguage;
}

const i8NOptions = {
    fallbackLng: "en",
    lng: "en",
    interpolation: {
        escapeValue: false,
    },
    partialBundledLanguages: true,
    resources: {
        en: {
            [DEFAULT_NAMESPACE]: {...translationsEnglish, ...translationAdditionsEn},
        },
    },
    ns: [DEFAULT_NAMESPACE],
    defaultNS: DEFAULT_NAMESPACE,
};

void i18n.use(initReactI18next).init(i8NOptions);

const originalChangeLanguage = i18n.changeLanguage.bind(i18n);
i18n.changeLanguage = ((lng?: string, callback?: Parameters<typeof i18n.changeLanguage>[1]) => {
    const requestedLanguage = resolveLanguage(lng ?? i18n.language ?? initialLanguage);
    return ensureLanguageResources(requestedLanguage)
        .then(loadedLanguage => originalChangeLanguage(loadedLanguage, callback))
        .catch(error => {
            console.error(`Failed to load translations for ${requestedLanguage}`, error);
            return originalChangeLanguage("en", callback);
        });
}) as typeof i18n.changeLanguage;

i18n.languages = [...supportedLanguages];
i18n.on("languageChanged", lng => {
    if (typeof window !== "undefined") {
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
    }
});

if (initialLanguage !== "en") {
    void i18n.changeLanguage(initialLanguage);
}

export default i18n;
