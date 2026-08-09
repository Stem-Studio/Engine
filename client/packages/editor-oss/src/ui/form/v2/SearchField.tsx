import {useEffect, useState} from "react";
import "../css/SearchField.css";
import classNames from "classnames";

import {CheckBox, IconButton} from ".";

interface Props {
    className?: string;
    style?: any;
    value?: string;
    data?: any[];
    placeholder?: string;
    showAddButton?: boolean;
    showFilterButton?: boolean;
    onAdd?: (event: any) => void;
    onChange?: (value: string, categories: any[], event: any) => void;
    onInput?: (value: string, categories: any[], event: any) => void;
}

const SearchField = ({
    className,
    style,
    value = "",
    data = [],
    placeholder = "Enter a keyword",
    showAddButton = false,
    showFilterButton = false,
    onAdd,
    onChange,
    onInput,
}: Props) => {
    const [searchValue, setSearchValue] = useState(value || "");
    const [categories, setCategories] = useState<string[]>([]);
    const [filterShow, setFilterShow] = useState(false);

    const handleAdd = (event: any) => {
        if (onAdd) onAdd(event);
    };

    const handleChange = (event: any) => {
        const {value} = event.target;
        setSearchValue(value);
        if (onChange) onChange(value, categories, event);
    };

    const handleInput = (event: any) => {
        const {value} = event.target;
        setSearchValue(value);
        if (onInput) onInput(value, categories, event);
    };

    const handleReset = (event: any) => {
        setSearchValue("");
        if (onInput) onInput("", categories, event);
        if (onChange) onChange("", categories, event);
    };

    const handleShowFilter = () => {
        setFilterShow(!filterShow);
    };

    const handleHideFilter = () => {
        setFilterShow(false);
    };

    const handleCheckBoxChange = (checked: boolean, name: string, event: any) => {
        let updatedCategories = [...categories];
        if (checked && !updatedCategories.includes(name)) {
            updatedCategories.push(name);
        } else if (!checked && updatedCategories.includes(name)) {
            updatedCategories = updatedCategories.filter(cat => cat !== name);
        }

        setCategories(updatedCategories);

        const {value} = event.target;
        if (onInput) onInput(value, updatedCategories, event);
        if (onChange) onChange(value, updatedCategories, event);
    };

    const stopPropagation = (event: any) => {
        event.stopPropagation();
    };

    useEffect(() => {
        document.addEventListener(`click`, handleHideFilter);
        return () => {
            document.removeEventListener(`click`, handleHideFilter);
        };
    }, []);

    return (
        <div className={classNames("SearchField", className)}
            style={style}
            onClick={stopPropagation}
        >
            {showAddButton && <IconButton icon={"add"}
                onClick={handleAdd}
                              />}
            <input
                className={"input"}
                placeholder={placeholder}
                value={searchValue}
                onChange={handleChange}
                onInput={handleInput}
            />
            <IconButton icon={"close"}
                onClick={handleReset}
            />
            {showFilterButton && 
                <IconButton
                    icon={"filter"}
                    className={classNames(filterShow && "selected")}
                    onClick={handleShowFilter}
                />
            }
            {showFilterButton && 
                <div className={classNames("category", !filterShow && "hidden")}>
                    <div className={"item"}
                        key={""}
                    >
                        <CheckBox name={""}
                            checked={categories.includes("")}
                            onChange={handleCheckBoxChange}
                        />
                        <label className={"title"}>No Type</label>
                    </div>
                    {data.map(n => 
                        <div className={"item"}
                            key={n.ID}
                        >
                            <CheckBox name={n.ID}
                                checked={categories.includes(n.ID)}
                                onChange={handleCheckBoxChange}
                            />
                            <label className={"title"}>{n.Name}</label>
                        </div>,
                    )}
                </div>
            }
        </div>
    );
};

export default SearchField;
