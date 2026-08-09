import {useEffect, useMemo, useRef, useState} from "react";
import {useOnClickOutside} from "usehooks-ts";

import {isPlaygroundMode} from "@web-shared/playgroundMode";
import {ActiveFilterOption, FilterOption} from "./CommunityFilters.style";
import filterIcon from "./filter-icon.svg";
import {FilterButton, FilterControl, FiltersList} from "./Filters.style";
import {useHomepageContext} from "@stem/editor-oss/context/HomepageContext";
import type {ProjectFilterType} from "../../../../CreateDashboard";

const PROJECT_FILTER_OPTIONS: {label: string; value: ProjectFilterType}[] = [
    {label: "Creation date", value: "creation_date"},
    {label: "Date modified", value: "date_modified"},
    {label: "Created by me", value: "created_by"},
    {label: "Shared", value: "shared"},
    {label: "Archived", value: "archived"},
    {label: "Plays", value: "plays"},
    {label: "Likes", value: "likes"},
    {label: "Remixed", value: "remixed"},
    {label: "Shares", value: "shared_count"},
];

export const Filters = () => {
    const [filtersOpen, setFiltersOpen] = useState(false);
    const {setProjectsFilter, projectsFilter} = useHomepageContext();
    const ref = useRef<HTMLDivElement>(null);
    const isPlayground = isPlaygroundMode();
    const filterOptions = useMemo(
        () => PROJECT_FILTER_OPTIONS.filter(option =>
            !isPlayground || !["plays", "likes", "remixed", "shared_count"].includes(option.value),
        ),
        [isPlayground],
    );
    useOnClickOutside(ref as React.RefObject<HTMLElement>, () => setFiltersOpen(false));

    useEffect(() => {
        if (!filterOptions.some(option => option.value === projectsFilter)) {
            setProjectsFilter("date_modified");
        }
    }, [filterOptions, projectsFilter, setProjectsFilter]);

    return (
        <FilterControl ref={ref}>
            <FilterButton
                type="button"
                aria-label="Sort projects"
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
                    {filterOptions.map(({label, value}) => {
                        const isActive = projectsFilter === value;
                        const Component = isActive ? ActiveFilterOption : FilterOption;

                        return (
                            <Component
                                key={value}
                                role="menuitem"
                                onClick={e => {
                                    e.stopPropagation();
                                    setProjectsFilter(value);
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
