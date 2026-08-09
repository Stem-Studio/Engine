type StarterType = "BlankProject" | "SandboxStarter";

/**
 * Retrieves starter-scene remix stats.
 */
export async function getStartersStats(): Promise<{blankProjectCount: number; sandboxStarterCount: number}> {
    return {blankProjectCount: 0, sandboxStarterCount: 0};
}

export async function updateStarterStats(_starterType: StarterType): Promise<any> {
    return null;
}
