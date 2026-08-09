import {CommunityFilters} from "./Filters/CommunityFilters";
import {Filters} from "./Filters/Filters";
import {Breadcrumb, Header, Label} from "./SectionHeader.style";
import {SECTION} from "../../../CreateDashboard";

export const SectionHeader = ({
    label,
    isExpanded,
    onCollapse,
}: {
    label: SECTION;
    isExpanded?: boolean;
    onCollapse?: () => void;
}) => {
    const showProjectsFilter = label === SECTION.PROJECTS;
    const showCommunityFilter = label === SECTION.COMMUNITY;

    return (
        <Header>
            <Label>
                {isExpanded && onCollapse ? (
                    <Breadcrumb>
                        <span className="breadcrumb-link" onClick={onCollapse}>Games</span>
                        <span className="breadcrumb-separator">&gt;</span>
                        <span className="breadcrumb-current">{label}</span>
                    </Breadcrumb>
                ) : (
                    <span className="labelText">{label}</span>
                )}
                {showProjectsFilter && <Filters />}
                {showCommunityFilter && <CommunityFilters />}
            </Label>
        </Header>
    );
};
