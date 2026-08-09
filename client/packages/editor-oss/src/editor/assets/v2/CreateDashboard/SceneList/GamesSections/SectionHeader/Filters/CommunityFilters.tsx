import {useRef, useState} from "react";
import {useOnClickOutside} from "usehooks-ts";

import {isPlaygroundMode} from "@web-shared/playgroundMode";
import {ActiveFilterOption, FilterOption} from "./CommunityFilters.style";
import filterIcon from "./filter-icon.svg";
import {FilterButton, FilterControl, FiltersList} from "./Filters.style";
import {useHomepageContext} from "@stem/editor-oss/context/HomepageContext";
import {CommunityFilterType} from "../../../../CreateDashboard";

const COMMUNITY_FILTER_OPTIONS: {label: string; value: CommunityFilterType}[] = [
    {label: "Most Played", value: "most_played"},
    {label: "Most Remixed", value: "most_remixed"},
    {label: "Most Shared", value: "most_shared"},
    {label: "Most Hearted", value: "most_hearted"},
];

export const CommunityFilters = () => {
    const isPlayground = isPlaygroundMode();
    const [filtersOpen, setFiltersOpen] = useState(false);
    const {communityFilter, setCommunityFilter} = useHomepageContext();
    const ref = useRef<HTMLDivElement>(null);
    useOnClickOutside(ref as React.RefObject<HTMLElement>, () => setFiltersOpen(false));

    if (isPlayground) {
        return null;
    }

    return (
        <FilterControl ref={ref}>
            <FilterButton
                type="button"
                aria-label="Sort community projects"
                aria-expanded={filtersOpen}
                $active={filtersOpen}
                onClick={() => setFiltersOpen(open => !open)}
            >
                <img
                    src={filterIcon}
                    alt=""
                    aria-hidden="true"
                />
            </FilterButton>
            {filtersOpen && (
                <FiltersList role="menu">
                    {COMMUNITY_FILTER_OPTIONS.map(({label, value}) => {
                        const isActive = communityFilter === value;
                        const Component = isActive ? ActiveFilterOption : FilterOption;
                        return (
                            <Component
                                key={value}
                                role="menuitem"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setCommunityFilter(value);
                                    setFiltersOpen(false);
                                }}
                            >
                                {label}
                            </Component>
                        );
                    })}
                </FiltersList>
            )}
        </FilterControl>
    );
};
