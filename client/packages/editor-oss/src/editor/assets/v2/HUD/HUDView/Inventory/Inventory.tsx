 
import {type RefObject, useEffect, useMemo, useRef, useState} from "react";
import {useOnClickOutside} from "usehooks-ts";

import inventoryIcon from "./assets/inventory-icon.svg";
import placeholderImage from "./assets/log.png";
import {Label, InventoryItem, Amount, InventoryContainer, ItemsContainer} from "./Inventory.style";
import {
    IAddToInventoryArgs,
    IDeleteFromInventoryArgs,
    IDeleteFromInventoryProps,
    IInventory,
    addToInventory,
    deleteFromInventory,
    getUserInventoryForGame,
    initInventory,
} from "@stem/network/api/inventory";
import {EVENTS, flushInventoryEvents} from "@stem/network/api/inventory/inventoryEvents";
import {INVENTORY_TYPES, INVENTORY_UI_CONTAINERS} from "@stem/editor-oss/types/editor";
import {findObjectByUuidDepthFirst} from "@stem/editor-oss/utils/SceneTraverser";
import {ResourcesUtils} from "@stem/editor-oss/utils/ResourcesUtils";
import {IconComponent} from "../../../common/HUDIcon";
import {isInputActive} from "../../../utils/isInputActive";
import {HUD_ITEM} from "../HUDView";

interface Props {
    isOpen: boolean;
    setIsOpen: React.Dispatch<React.SetStateAction<HUD_ITEM | null>>;
}

export const Inventory = ({isOpen, setIsOpen}: Props) => {
    const urlSearchParams = new URLSearchParams(window.location.search);
    const SceneID = urlSearchParams.get("sceneID");
    const UserID = urlSearchParams.get("UserID");

    const [game, setGame] = useState<any>();
    const [behaviors, setBehaviors] = useState<any[]>();
    const [inventoryObjects, setInventoryObjects] = useState<IInventory[]>([]);

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key.toLocaleLowerCase() === "i" && !isInputActive()) {
            setIsOpen(prev => prev === HUD_ITEM.INVENTORY ? null : HUD_ITEM.INVENTORY);
        }
    };

    useEffect(() => {
        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    useEffect(() => {
        const setupBasicInventory = async () => {
            const initialInventory: IInventory[] = [];
            behaviors?.forEach(el => {
                initialInventory.push({UUID: el.uuid, Name: el.name ?? el.uuid, Amount: 1});
            });
            if (!UserID) {
                setInventoryObjects(initialInventory);
                return;
            }
            if (!SceneID) {
                return console.error("Scene id missing.");
            }
            await initInventory({UserID, SceneID, InventoryItems: JSON.stringify(initialInventory)}, () => {
                setInventoryObjects(initialInventory);
            });
        };

        const getInventory = async () => {
            if (!UserID) {
                return console.error("User data missing.");
            }
            if (!SceneID) {
                return console.error("Scene id missing.");
            }
            const response = await getUserInventoryForGame({UserID, SceneID});
            if (response) {
                setInventoryObjects(response.inventory);
                if (response.noInitialInventory) {
                    setupBasicInventory();
                }
            }
        };

        getInventory();
    }, []);

    useEffect(() => {
        const deleteItemFromInventory = async (e: any) => {
            const inventoryObject: IDeleteFromInventoryProps = e.detail;

            if (!UserID) {
                setInventoryObjects(prev => prev.filter(item => item.UUID !== inventoryObject.InventoryItemUUID));
                return;
            }

            if (!SceneID) {
                return console.error("Scene id missing.");
            }

            const inventoryObjectToSend: IDeleteFromInventoryArgs = {
                UserID,
                SceneID,
                InventoryItemUUID: inventoryObject.InventoryItemUUID,
                AmountToRemove: inventoryObject.AmountToRemove,
            };
            const response = await deleteFromInventory(inventoryObjectToSend);
            if (response) {
                setInventoryObjects(response);
            }
        };

        const addItemToInventory = async (e: any) => {
            const inventoryObject: IInventory = e.detail;
            if (!UserID) {
                setInventoryObjects(prev => [...prev, inventoryObject]);
                return;
            }

            if (!SceneID) {
                return console.error("Scene id missing.");
            }

            const inventoryObjectToSend: IAddToInventoryArgs = {
                UserID,
                SceneID,
                InventoryItem: JSON.stringify(inventoryObject),
            };
            const response = await addToInventory(inventoryObjectToSend);
            if (response) {
                setInventoryObjects(response);
            }
        };

        const initInventory = (e: any) => {
            const dataObject = e.detail;
            setGame(dataObject.game);
            setBehaviors(dataObject.behaviors);
        };

        flushInventoryEvents({initInventory, addItemToInventory, deleteItemFromInventory});

        window.addEventListener(EVENTS.INVENTORY_ADD, addItemToInventory);
        window.addEventListener(EVENTS.INVENTORY_INIT, initInventory);
        window.addEventListener(EVENTS.INVENTORY_DELETE, deleteItemFromInventory);

        return () => {
            window.removeEventListener(EVENTS.INVENTORY_ADD, addItemToInventory);
            window.removeEventListener(EVENTS.INVENTORY_INIT, initInventory);
            window.removeEventListener(EVENTS.INVENTORY_DELETE, deleteItemFromInventory);
        };
    }, []);

    return (
        <>
            {isOpen && <InventoryRenderer inventory={inventoryObjects}
                game={game}
                close={() => setIsOpen(null)}
                       />}
            <IconComponent
                $active={isOpen}
                onClick={() => setIsOpen(prev => prev === HUD_ITEM.INVENTORY ? null : HUD_ITEM.INVENTORY)}
            >
                <img src={inventoryIcon}
                    alt=""
                />
            </IconComponent>
        </>
    );
};

interface IInventoryRendererProps {
    inventory: IInventory[];
    game: any;
    close: () => void;
}

export const InventoryRenderer = ({inventory, game, close}: IInventoryRendererProps) => {
    const [fullInventoryData, setFullInventoryData] = useState<any[]>([]);
    const [isInventoryLoaded, setIsInventoryLoaded] = useState(false);

    const fullInventoryDataRef = useRef<any[]>([]);
    const inventoryContainerRef = useRef<HTMLDivElement>(null);

    const emptyFields = useMemo(() => {
        return isInventoryLoaded ? new Array(25 - fullInventoryData.length).fill({}) : [];
    }, [fullInventoryData.length, isInventoryLoaded]);

    useOnClickOutside(inventoryContainerRef as RefObject<HTMLDivElement>, () => {
        close();
    });

    useEffect(() => {
        const refreshedInventory: any[] = [];
        inventory.forEach((el: any) => {
            if (el.uuid || el.UUID) {
                const uuid = el.uuid ?? el.UUID;
                const amount = el.amount ?? el.Amount;
                const isHarvesting = el.isHarvesting ?? !!el.IsHarvesting;
                const name = el.name ?? el.Name;

                let behavior = {};
                if (isHarvesting && name) {
                    behavior = {
                        type: INVENTORY_TYPES.CONSUMABLE,
                        uiImage: ResourcesUtils.nameToResourceImage(name),
                    };
                } else {
                    const obj = game?.scene ? findObjectByUuidDepthFirst(game.scene, uuid) : null;

                    if (!obj) return;

                    behavior = obj.userData.behaviors.filter((behavior: any) =>
                        Object.values(INVENTORY_TYPES).includes(behavior.type),
                    )[0];
                }

                const existingItem = refreshedInventory.find(item => item.uuid === uuid);

                if (existingItem) {
                    existingItem.amount += amount;
                } else {
                    refreshedInventory.push({amount, uuid, ...behavior});
                }
            }
        });

        refreshedInventory.sort((a: any, b: any) => {
            const typeOrder = [
                INVENTORY_TYPES.WEAPON_AMMO,
                INVENTORY_TYPES.WEAPON,
                INVENTORY_TYPES.CONSUMABLE,
                INVENTORY_TYPES.THROWABLE,
            ];
            return typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type);
        });

        setFullInventoryData(refreshedInventory);
        setIsInventoryLoaded(true);
    }, [inventory]);

    useEffect(() => {
        fullInventoryDataRef.current = fullInventoryData;
    }, [fullInventoryData]);

    const handleItemClick = (uuid: string) => {
        const scene = game?.scene;
        if (!scene) {
            return;
        }

        fullInventoryDataRef.current.forEach((el: any) => {
            const item = findObjectByUuidDepthFirst(scene, el.uuid);
            if (item) {
                item.userData.uiInventorySelected = false;
            }
        });

        const selectedObject = findObjectByUuidDepthFirst(scene, uuid);
        if (selectedObject) {
            selectedObject.userData.uiInventorySelected = true;
            selectedObject.visible = true;
        }
    };

    return (
        <InventoryContainer ref={inventoryContainerRef}
            className="hidden-scroll"
        >
            <Label>Inventory</Label>
            <ItemsContainer>
                {fullInventoryData?.map((inventory: any, index: number) => {
                    const uiImage = inventory.uiImage || placeholderImage;
                    const categoryName = (inventory.type + "s").toLowerCase();
                    return (
                        <InventoryItem
                            onClick={() => handleItemClick(inventory.uuid)}
                            key={categoryName + index}
                            className={inventory.type}
                            $bgImage={uiImage}
                            id={INVENTORY_UI_CONTAINERS.ICON_PREFIX + inventory.uuid}
                        >
                            <Amount>{inventory.amount}</Amount>
                        </InventoryItem>
                    );
                })}
                {emptyFields?.map((_, index: number) => <InventoryItem key={index} />)}
            </ItemsContainer>
        </InventoryContainer>
    );
};
