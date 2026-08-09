import React from "react";

export const PrivacyPolicy: React.FC = () => (
    <main style={{padding: "2rem", maxWidth: "48rem", margin: "0 auto"}}>
        <h1>Privacy</h1>
        <p>
            StemStudio runs entirely on your machine. No telemetry is
            reported. Projects are stored in this browser&apos;s IndexedDB or
            in a folder you picked. AI provider keys you configure are
            stored locally and only forwarded to the AI server you point
            the editor at.
        </p>
        <p>
            If a deployment of this build adds telemetry or hosted
            services, refer to that operator&apos;s documentation.
        </p>
    </main>
);

export default PrivacyPolicy;
