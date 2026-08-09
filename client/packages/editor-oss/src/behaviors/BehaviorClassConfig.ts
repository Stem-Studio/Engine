
export default interface BehaviorClassConfig {
    id: string;
    name?: string;
    main: string;
    isScript: boolean;
    attributes: Record<string, any>;
    priority?: number;
    startupPhase?: "world" | "gameplay" | "late";
    tags?: string[];
    worker?: boolean;
}
