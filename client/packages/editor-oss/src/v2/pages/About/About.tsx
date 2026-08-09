import {useTranslation} from "react-i18next";

import {DashboardHeader} from "../../../editor/assets/v2/CreateDashboard/DashboardLayout/DashboardHeader/DashboardHeader";
import {Footer} from "../../Footer/Footer";

import {Container, Content, Wrapper} from "./About.style";

export const About = () => {
    const {t} = useTranslation();

    return (
        <Container>
            <DashboardHeader />
            <Wrapper>
                <Content>
                    <h1>{t("About StemStudio")}</h1>
                    <p className="lede">
                        {t(
                            "StemStudio is a browser-based 3D sandbox for building, scripting, and playing games. The editor, runtime, physics, multiplayer, and AI helpers all run in the same tab — there is nothing to install.",
                        )}
                    </p>

                    <h2>{t("What you can build")}</h2>
                    <p>
                        {t(
                            "Anything that fits in a browser-side 3D scene: platformers, racers, sandbox worlds, multiplayer rooms, interactive exhibits, training simulations. The engine is built on Three.js with a behaviour system you script in JavaScript, an ECS-style lambda layer for batched work, and physics provided by Ammo.js or Rapier.",
                        )}
                    </p>

                    <h2>{t("How it works")}</h2>
                    <ul>
                        <li>
                            {t(
                                "Drop primitives, models, lights, and cameras into the scene. Drag-and-drop assets from your machine or pull from any glTF / FBX source.",
                            )}
                        </li>
                        <li>
                            {t(
                                "Attach behaviours to objects to give them logic. Each behaviour is a small JavaScript class with a lifecycle (init, update, onCollision, …) and a typed attribute panel.",
                            )}
                        </li>
                        <li>
                            {t(
                                "Wire AI helpers via bring-your-own-keys: text-to-3D model generation, NPC dialogue, voice synthesis, behaviour generation. Every provider key stays in your browser.",
                            )}
                        </li>
                        <li>
                            {t(
                                "Save to a local folder or to the browser's IndexedDB. Share by exporting the project as a .stemscript.json file or by hosting the static player build.",
                            )}
                        </li>
                    </ul>

                    <h2>{t("Open source")}</h2>
                    <p>
                        {t(
                            "The editor, runtime, and core behaviour pack are open source under the MIT license. You can run StemStudio entirely on your own machine — no accounts, no cloud, no telemetry. AI features use bring-your-own provider keys through the local AI server.",
                        )}
                    </p>

                    <h2>{t("Get involved")}</h2>
                    <p>
                        {t(
                            "Build a game and share it. File issues, send pull requests, or help with documentation. The community lives in the Discord server linked in the footer.",
                        )}
                    </p>
                </Content>
            </Wrapper>
            <Footer />
        </Container>
    );
};
