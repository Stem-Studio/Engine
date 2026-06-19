const proxyApi = process.env.REACT_APP_PROXY_API || "https://stemproxy.develop.erth.xyz";

export const DIRECT_AI_PROVIDER_CONNECT_SOURCES = [
    "https://api.openai.com",
    "https://api.openai.com/*",
    "https://api.anthropic.com",
    "https://api.anthropic.com/*",
    "https://generativelanguage.googleapis.com",
    "https://generativelanguage.googleapis.com/*",
];

// Define the base type for CSP directives
type CSPDirective =
    | "default-src"
    | "script-src"
    | "connect-src"
    | "worker-src"
    | "img-src"
    | "style-src"
    | "font-src"
    | "media-src"
    | "object-src"
    | "frame-src";

// Define the type for the policies object
type CSPPolicies = {
    [K in CSPDirective]?: string[];
};

const CSPMetaTag = ({customPolicies = {}}) => {
    // Default CSP policies
    const defaultPolicies = {
        "default-src": ["'self'"],
        "script-src": [
            "'self'",
            "https://unpkg.com",
            "https://www.googletagmanager.com",
            "https://cdn.jsdelivr.net/",
            "https://esm.sh",
            "https://esm.sh/*",
            "'unsafe-inline'",
            "'unsafe-eval'",
            // Firebase Auth's bundled reCAPTCHA verifier
            "https://www.google.com",
            "https://www.gstatic.com",
        ],
        "connect-src": [
            "'self'",
            "data:",
            "https://esm.sh",
            "https://*.googleapis.com",
            ...DIRECT_AI_PROVIDER_CONNECT_SOURCES,
            "https://*.google-analytics.com",
            "https://unpkg.com",
            "https://cdn.discordapp.com",
            "https://discord.com",
            "blob:",
            // Asset uploads / downloads
            "https://s3.us-east-1.amazonaws.com",
            "https://*.s3.us-east-1.amazonaws.com",
            // Hyper3D Rodin API + output CDN (browser-direct generation in playground)
            "https://hyperhuman.deemos.com",
            "https://hyperhuman.deemos.com/*",
            "https://*.deemos.com",
            // Local asset uploads
            "http://minio:9000",
            proxyApi,
            `${proxyApi}/*`,
        ],
        "worker-src": ["'self'", "blob:", "https://esm.sh", "https://esm.sh/*"],
        "img-src": ["*", "data:", "blob:"],
        "style-src": ["*", "'unsafe-inline'"],
        "font-src": ["*", "data:"],
        "media-src": ["*", "blob:", "data:"],
        "object-src": ["'none'"],
        "frame-src": ["*"],
    };

    // Merge custom policies with defaults
    const mergedPolicies = {...defaultPolicies, ...customPolicies};

    // Convert policies object to CSP string. Filter blanks first — when an
    // env var like REACT_APP_SERVER_HOST is unset, template strings such as
    // `${process.env.REACT_APP_SERVER_HOST}/` collapse to literal `undefined/`
    // or `https:///`, which the browser logs as "invalid source" warnings.
    const isValidCSPSource = (s: string): boolean => {
        if (!s) return false;
        const t = s.trim();
        if (!t) return false;
        if (t.includes("undefined")) return false;
        // https:/// or wss:/// — empty host after scheme://
        if (/^[a-z]+:\/{2,}(?:\/\*)?$/.test(t)) return false;
        // <URL> placeholder
        if (t.includes("<URL>")) return false;
        return true;
    };
    const buildCSPString = (policies: CSPPolicies) => {
        return Object.entries(policies)
            .map(([key, values]) => `${key} ${(values ?? []).filter(isValidCSPSource).join(" ")}`)
            .join("; ");
    };

    const cspContent = buildCSPString(mergedPolicies);

    return <meta httpEquiv="Content-Security-Policy"
        content={cspContent}
           />;
};

export default CSPMetaTag;
const CSP_TAGS: string[] = [];

(process.env.REACT_APP_ORIGIN_CSP ?? "").split(",").forEach(cspTagEndpoint => {
    if (
        !cspTagEndpoint.startsWith("https://") &&
        !cspTagEndpoint.startsWith("http://") &&
        !cspTagEndpoint.startsWith("wss://") &&
        !cspTagEndpoint.startsWith("ws://")
    ) {
        CSP_TAGS.push(
            `https://${cspTagEndpoint}/`,
            `https://${cspTagEndpoint}/*`,
            `wss://${cspTagEndpoint}/`,
            `wss://${cspTagEndpoint}/*`,
        );
    } else {
        CSP_TAGS.push(`${cspTagEndpoint}/`, `${cspTagEndpoint}/*`);
    }
});

export const customCSPPolicies = {
    "script-src": [
        "'self'",
        `${process.env.REACT_APP_SERVER_HOST}/`,
        `${process.env.REACT_APP_SERVER_HOST}/*`,
        ...CSP_TAGS,
        "'unsafe-inline'",
        "'unsafe-eval'",
        //below this is for web not for discord
        "https://unpkg.com",
        "https://www.googletagmanager.com",
        "https://cdn.jsdelivr.net/",
        "https://apis.google.com",
        // Firebase Auth's bundled reCAPTCHA verifier (Google sign-in popup flow)
        "https://www.google.com",
        "https://www.gstatic.com",
        // Monaco editor modules
        "https://esm.sh",
        "https://esm.sh/*",
    ],
    "connect-src": [
        "'self'",
        "data:",
        `${process.env.REACT_APP_SERVER_HOST}/`,
        `${process.env.REACT_APP_SERVER_HOST}/*`,
        `${process.env.REACT_APP_MULTIPLAYER_SERVER_URL}`,
        `${process.env.REACT_APP_MULTIPLAYER_SERVER_URL}/*`,
        `${process.env.REACT_APP_MULTIPLAYER_SERVER_URL}`.replace("wss://", "https://"),
        `${process.env.REACT_APP_MULTIPLAYER_SERVER_URL}/*`.replace("wss://", "https://"),
        `${process.env.REACT_APP_MULTIPLAYER_API_SERVER}`,
        `${process.env.REACT_APP_MULTIPLAYER_API_SERVER}/*`,
        ...CSP_TAGS,
        //below this is for web not for discord
        "http://localhost:2567/",
        "http://localhost:2567/*",
        "ws://localhost:2568/",
        "ws://localhost:2568/*",
        "ws://localhost:2567/",
        "ws://localhost:2567/*",
        "ws://localhost:3000/",
        "ws://localhost:3000/*",
        "http://localhost:3000/",
        "http://localhost:3000/*",
        "https://*.googleapis.com",
        ...DIRECT_AI_PROVIDER_CONNECT_SOURCES,
        "https://*.google-analytics.com",
        "https://unpkg.com",
        "https://cdn.discordapp.com",
        "https://discord.com",
        "blob:",
        "https://cdn.cloud.scenario.com",
        "https://tripo-data.cdn.bcebos.com",
        "https://assets.meshy.ai",
        "https://assets.meshy.ai/*",
        // Hyper3D Rodin API + output CDN (browser-direct generation in playground)
        "https://hyperhuman.deemos.com",
        "https://hyperhuman.deemos.com/*",
        "https://*.deemos.com",
        "https://www.gstatic.com",
        // Firebase Auth's bundled reCAPTCHA verifier challenge requests
        "https://www.google.com",
        proxyApi,
        `${proxyApi}/*`,
        "https://dl.polyhaven.org/",
        "https://dl.polyhaven.org/*",
        "https://sketchfab-prod-media.s3.amazonaws.com/",
        "https://sketchfab-prod-media.s3.amazonaws.com/*",
        // Asset uploads / downloads
        "https://s3.us-east-1.amazonaws.com",
        "https://*.s3.us-east-1.amazonaws.com",
        // Local asset uploads
        "http://minio:9000",
        // Monaco editor grammar files
        "https://esm.sh",
        "https://esm.sh/*",
    ],
    "frame-src": [
        "'self'",
        "*",
        ...CSP_TAGS,
        `${process.env.REACT_APP_SERVER_HOST}/`,
        `${process.env.REACT_APP_SERVER_HOST}/*`,
        `${process.env.REACT_APP_AUTH_IFRAME_URL}/`,
        `${process.env.REACT_APP_AUTH_IFRAME_URL}/*`,
    ],
    "worker-src": [
        "blob:",
        "'self'",
        ...CSP_TAGS,
        `${process.env.REACT_APP_SERVER_HOST}/`,
        `${process.env.REACT_APP_SERVER_HOST}/*`,
        // Monaco editor workers
        "https://esm.sh",
        "https://esm.sh/*",
    ],
};
