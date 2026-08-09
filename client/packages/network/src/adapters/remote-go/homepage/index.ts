export type HomepageSuggestion = {
    id?: string;
    label: string;
    prompt: string;
};

export type HomepageContent = {
    gamesCreated: number;
    suggestions: HomepageSuggestion[];
};

export const getHomepageContent = async (): Promise<HomepageContent> => {
    return {gamesCreated: 0, suggestions: []};
};
