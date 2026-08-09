import {ChangeEvent, useEffect, useMemo, useState} from "react";

import {
    CompactCheckboxRow,
    FieldRow,
    FormHeader,
    InlineActions,
    MockModeControl,
    ProductCard,
    ProductIdText,
    ProductImagePreview,
    ProductNameCell,
    ProductsTable,
    ProductsTableWrap,
    StatusBadge,
} from "./Products.style";
import {
    AdminStripeProduct,
    bulkGrantCredits,
    createAdminProduct,
    deleteAdminProduct,
    getAdminProducts,
    getStripeMockMode,
    migrateProduct,
    setStripeMockMode,
    updateAdminProduct,
} from "@stem/network/api/stripe";
import {useAppGlobalContext} from "@stem/editor-oss/context/AppGlobalContext";
import {showToast} from "@stem/editor-oss/showToast";
import {ModelUtils} from "@stem/editor-oss/utils/ModelUtils";
import {NumericInput} from "../../../common/NumericInput";
import {StyledButton} from "../../../common/StyledButton";
import {PanelCheckbox} from "../../../RightPanel/common/PanelCheckbox";
import {Separator} from "../../../RightPanel/common/Separator";
import {AccountBox} from "../../SettingsPage/SettingsPage.style";
import {Settings} from "../AdminPanel.style";

const EMPTY_PRODUCT: AdminStripeProduct = {
    productId: "",
    name: "",
    subtitle: "",
    imageUrl: "",
    credits: 0,
    priceOneTime: 0,
    priceRecurring: 0,
    priceYearly: 0,
    monthlyDiscountPercent: 0,
    features: [],
    stripePriceOneTime: "",
    stripePriceRecurring: "",
    stripePriceYearly: "",
    active: true,
    sortOrder: 0,
};

type ProductOp = {type: "none"} | {type: "create"} | {type: "edit"; productId: string};

const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const Products = () => {
    const isLocalhost =
        typeof window !== "undefined" && ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    const [loading, setLoading] = useState(false);
    const [products, setProducts] = useState<AdminStripeProduct[]>([]);
    const [bulkCredits, setBulkCredits] = useState(0);
    const [mockMode, setMockMode] = useState(false);
    const [operation, setOperation] = useState<ProductOp>({type: "none"});
    const [draft, setDraft] = useState<AdminStripeProduct | null>(null);
    const {setMainLoaderState} = useAppGlobalContext();

    useEffect(() => {
        loadProducts();
        loadMockMode();
    }, []);

    const selectedProduct = useMemo(() => {
        if (operation.type !== "edit") return null;
        return products.find(p => p.productId === operation.productId) ?? null;
    }, [operation, products]);

    const loadProducts = async () => {
        setLoading(true);
        try {
            const data = await getAdminProducts();
            setProducts(data);
        } catch {
            showToast({type: "error", title: "Failed to load products"});
        } finally {
            setLoading(false);
        }
    };

    const loadMockMode = async () => {
        try {
            setMockMode(await getStripeMockMode());
        } catch {
            // ignore
        }
    };

    const beginCreate = () => {
        setDraft({...EMPTY_PRODUCT});
        setOperation({type: "create"});
    };

    const beginEdit = (product: AdminStripeProduct) => {
        setDraft({...product, features: [...product.features]});
        setOperation({type: "edit", productId: product.productId});
    };

    const cancelForm = () => {
        setDraft(null);
        setOperation({type: "none"});
    };

    const updateDraft = (field: keyof AdminStripeProduct, value: unknown) => {
        setDraft(prev => (prev ? {...prev, [field]: value} : prev));
    };

    const handleUploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !draft) return;

        setLoading(true);
        try {
            const uploaded = await ModelUtils.uploadThumbnail(file);
            setDraft({...draft, imageUrl: uploaded});
            showToast({type: "success", title: "Image uploaded"});
        } catch (e) {
            showToast({type: "error", title: (e instanceof Error && e.message) || "Failed to upload image"});
        } finally {
            setLoading(false);
            event.target.value = "";
        }
    };

    const handleCreateProduct = async () => {
        if (!draft || !draft.productId.trim()) {
            showToast({type: "error", title: "Product ID is required"});
            return;
        }

        setLoading(true);
        try {
            await createAdminProduct(draft);
            showToast({type: "success", title: "Product created"});
            cancelForm();
            await loadProducts();
        } catch (e) {
            showToast({type: "error", title: (e instanceof Error && e.message) || "Failed to create product"});
        } finally {
            setLoading(false);
        }
    };

    const handleSaveProduct = async () => {
        if (!draft || operation.type !== "edit") return;

        const newUsersOnly = window.confirm(
            "Apply changes to new users only? OK = create new version for new users, Cancel = migrate all subscribers.",
        );

        setLoading(true);
        try {
            const payload = {
                productId: operation.productId,
                name: draft.name,
                subtitle: draft.subtitle,
                imageUrl: draft.imageUrl || "",
                credits: draft.credits,
                priceOneTime: draft.priceOneTime,
                priceRecurring: draft.priceRecurring,
                priceYearly: draft.priceYearly,
                monthlyDiscountPercent: draft.monthlyDiscountPercent,
                features: draft.features,
                stripePriceOneTime: draft.stripePriceOneTime,
                stripePriceRecurring: draft.stripePriceRecurring,
                stripePriceYearly: draft.stripePriceYearly,
                migrateAll: !newUsersOnly,
            };
            const result = await migrateProduct(payload);
            if (newUsersOnly) {
                showToast({type: "success", title: `Created new product: ${result.newProductId}`});
            } else {
                showToast({type: "success", title: `Updated product. ${result.notifiedCount || 0} users notified.`});
            }
            cancelForm();
            await loadProducts();
        } catch (e) {
            showToast({type: "error", title: (e instanceof Error && e.message) || "Failed to save product"});
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteProduct = async (product: AdminStripeProduct) => {
        const wantsGrandfather = window.confirm(
            "Keep existing subscribers on this plan? OK = grandfather. Cancel = discontinue and request prorated refunds.",
        );

        let strategy: "grandfather" | "discontinue_refund_prorated";
        if (wantsGrandfather) {
            strategy = "grandfather";
        } else {
            const confirmDiscontinue = window.confirm(
                "Discontinue this plan, cancel active subscriptions, and request prorated refunds?",
            );
            if (!confirmDiscontinue) return;
            strategy = "discontinue_refund_prorated";
        }

        setLoading(true);
        try {
            await deleteAdminProduct(product.productId, strategy);
            showToast({
                type: "success",
                title:
                    strategy === "grandfather"
                        ? "Plan grandfathered (no new signups)"
                        : "Plan discontinued and prorated refunds requested",
            });
            if (operation.type === "edit" && operation.productId === product.productId) {
                cancelForm();
            }
            await loadProducts();
        } catch (e) {
            showToast({type: "error", title: (e instanceof Error && e.message) || "Failed to delete plan"});
        } finally {
            setLoading(false);
        }
    };

    const handleToggleActive = async (product: AdminStripeProduct) => {
        setLoading(true);
        try {
            await updateAdminProduct({productId: product.productId, active: !product.active});
            showToast({type: "success", title: product.active ? "Product deactivated" : "Product activated"});
            await loadProducts();
        } catch (e) {
            showToast({type: "error", title: (e instanceof Error && e.message) || "Failed to toggle product"});
        } finally {
            setLoading(false);
        }
    };

    const handleMockModeToggle = () => {
        const next = !mockMode;
        setMockMode(next);
        setStripeMockMode(next)
            .then(() => showToast({type: "success", title: `Mock mode ${next ? "enabled" : "disabled"}`}))
            .catch(() => {
                setMockMode(!next);
                showToast({type: "error", title: "Failed to toggle mock mode"});
            });
    };

    const handleBulkGrant = async () => {
        if (bulkCredits <= 0) return;
        const confirmed = window.confirm(`Grant ${bulkCredits} credits to all users?`);
        if (!confirmed) return;

        setLoading(true);
        try {
            await bulkGrantCredits(bulkCredits);
            showToast({type: "success", title: "Credits granted to all users"});
            setBulkCredits(0);
        } catch {
            showToast({type: "error", title: "Failed to grant credits"});
        } finally {
            setLoading(false);
        }
    };

    const renderFormFields = () => {
        if (!draft) return null;

        return (
            <>
                {operation.type === "create" && (
                    <FieldRow>
                        <label>Product ID</label>
                        <input
                            value={draft.productId}
                            onChange={e => updateDraft("productId", e.target.value)}
                            placeholder="e.g. starter_v1"
                        />
                    </FieldRow>
                )}
                <FieldRow>
                    <label>Name</label>
                    <input
                        value={draft.name}
                        onChange={e => updateDraft("name", e.target.value)}
                    />
                </FieldRow>
                <FieldRow>
                    <label>Subtitle</label>
                    <input
                        value={draft.subtitle}
                        onChange={e => updateDraft("subtitle", e.target.value)}
                    />
                </FieldRow>
                <FieldRow>
                    <label>Product Image</label>
                    <InlineActions>
                        <ProductImagePreview
                            src={draft.imageUrl || "https://dummyimage.com/68x68/2d2d2d/999999&text=No+Img"}
                            alt="Product"
                        />
                        <input
                            type="text"
                            value={draft.imageUrl || ""}
                            onChange={e => updateDraft("imageUrl", e.target.value)}
                            placeholder="Image URL"
                            style={{minWidth: 260}}
                        />
                        <input
                            type="file"
                            accept="image/*"
                            onChange={handleUploadImage}
                        />
                    </InlineActions>
                </FieldRow>
                <FieldRow>
                    <label>Credits</label>
                    <NumericInput
                        value={draft.credits}
                        setValue={v => updateDraft("credits", v)}
                        min={0}
                        width="200px"
                        height="36px"
                    />
                </FieldRow>
                <FieldRow>
                    <label>One-time Price</label>
                    <NumericInput
                        value={draft.priceOneTime}
                        setValue={v => updateDraft("priceOneTime", v)}
                        min={0}
                        width="160px"
                        height="36px"
                    />
                    <span style={{color: "rgba(255,255,255,0.5)"}}>{formatCents(draft.priceOneTime)}</span>
                </FieldRow>
                <FieldRow>
                    <label>Monthly Price</label>
                    <NumericInput
                        value={draft.priceRecurring}
                        setValue={v => updateDraft("priceRecurring", v)}
                        min={0}
                        width="160px"
                        height="36px"
                    />
                    <span style={{color: "rgba(255,255,255,0.5)"}}>{formatCents(draft.priceRecurring)} /mo</span>
                </FieldRow>
                <FieldRow>
                    <label>Yearly Price</label>
                    <NumericInput
                        value={draft.priceYearly}
                        setValue={v => updateDraft("priceYearly", v)}
                        min={0}
                        width="160px"
                        height="36px"
                    />
                    <span style={{color: "rgba(255,255,255,0.5)"}}>{formatCents(draft.priceYearly)} /yr</span>
                </FieldRow>
                <FieldRow>
                    <label>Stripe Price IDs</label>
                    <div style={{display: "flex", flexDirection: "column", gap: 6, flex: 1}}>
                        <input
                            value={mockMode ? "(auto-generated)" : draft.stripePriceOneTime || ""}
                            readOnly
                        />
                        <input
                            value={mockMode ? "(auto-generated)" : draft.stripePriceRecurring || ""}
                            readOnly
                        />
                        <input
                            value={mockMode ? "(auto-generated)" : draft.stripePriceYearly || ""}
                            readOnly
                        />
                    </div>
                </FieldRow>
                <FieldRow>
                    <label>Features (one per line)</label>
                    <textarea
                        value={draft.features.join("\n")}
                        onChange={e =>
                            updateDraft(
                                "features",
                                e.target.value
                                    .split("\n")
                                    .map(v => v.trim())
                                    .filter(Boolean),
                            )
                        }
                        rows={4}
                        style={{resize: "vertical"}}
                    />
                </FieldRow>
                <CompactCheckboxRow>
                    <label>Active</label>
                    <PanelCheckbox
                        text=""
                        checked={draft.active}
                        onChange={() => updateDraft("active", !draft.active)}
                        v2
                        isGray
                        regular
                    />
                </CompactCheckboxRow>
            </>
        );
    };

    useEffect(() => {
        setMainLoaderState({visible: loading, message: ""});
    }, [setMainLoaderState, loading]);

    return (
        <>
            <AccountBox className="box">
                <div
                    className="wrapper"
                    style={{color: "#fff"}}
                >
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: 16,
                        }}
                    >
                        <h3 style={{margin: 0}}>Products</h3>
                        <InlineActions>
                            {isLocalhost && (
                                <MockModeControl>
                                    <PanelCheckbox
                                        text="Mock Mode"
                                        checked={mockMode}
                                        onChange={handleMockModeToggle}
                                        v2
                                        isGray
                                        regular
                                    />
                                </MockModeControl>
                            )}
                            <StyledButton
                                isBlue
                                onClick={beginCreate}
                                height="32px"
                                style={{fontSize: "13px", minWidth: "170px"}}
                            >
                                + New Product
                            </StyledButton>
                        </InlineActions>
                    </div>

                    <ProductsTableWrap>
                        <ProductsTable>
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Credits</th>
                                    <th>One-time</th>
                                    <th>Monthly</th>
                                    <th>Yearly</th>
                                    <th>Active</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {products.map(product => (
                                    <tr key={product.productId}>
                                        <td>
                                            <InlineActions>
                                                <ProductImagePreview
                                                    src={
                                                        product.imageUrl ||
                                                        "https://dummyimage.com/68x68/2d2d2d/999999&text=No+Img"
                                                    }
                                                    alt={product.name}
                                                />
                                                <ProductNameCell>
                                                    <strong>{product.name || product.productId}</strong>
                                                    <ProductIdText>{product.productId}</ProductIdText>
                                                </ProductNameCell>
                                            </InlineActions>
                                        </td>
                                        <td>{product.credits.toLocaleString()}</td>
                                        <td>{formatCents(product.priceOneTime)}</td>
                                        <td>{formatCents(product.priceRecurring)}</td>
                                        <td>{formatCents(product.priceYearly)}</td>
                                        <td>
                                            <StatusBadge $active={product.active}>
                                                {product.active ? "Active" : "Inactive"}
                                            </StatusBadge>
                                        </td>
                                        <td>
                                            <InlineActions>
                                                <StyledButton
                                                    isBlue
                                                    onClick={() => beginEdit(product)}
                                                    height="30px"
                                                    style={{fontSize: "12px"}}
                                                >
                                                    Edit
                                                </StyledButton>
                                                <StyledButton
                                                    onClick={() => handleToggleActive(product)}
                                                    height="30px"
                                                    style={{fontSize: "12px"}}
                                                >
                                                    {product.active ? "Deactivate" : "Activate"}
                                                </StyledButton>
                                                <StyledButton
                                                    onClick={() => handleDeleteProduct(product)}
                                                    height="30px"
                                                    style={{fontSize: "12px"}}
                                                >
                                                    Delete
                                                </StyledButton>
                                            </InlineActions>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </ProductsTable>
                    </ProductsTableWrap>

                    {draft && (
                        <ProductCard>
                            <FormHeader>
                                <strong>
                                    {operation.type === "create"
                                        ? "New Product"
                                        : `Edit Product: ${selectedProduct?.productId || ""}`}
                                </strong>
                                <StatusBadge $active={draft.active}>{draft.active ? "Active" : "Inactive"}</StatusBadge>
                            </FormHeader>
                            {renderFormFields()}
                            <InlineActions>
                                {operation.type === "create" ? (
                                    <StyledButton
                                        isBlue
                                        onClick={handleCreateProduct}
                                        disabled={loading || !draft.productId.trim()}
                                        height="36px"
                                        style={{fontSize: "13px"}}
                                    >
                                        Create Product
                                    </StyledButton>
                                ) : (
                                    <StyledButton
                                        isBlue
                                        onClick={handleSaveProduct}
                                        disabled={loading}
                                        height="36px"
                                        style={{fontSize: "13px"}}
                                    >
                                        Save Changes
                                    </StyledButton>
                                )}
                                <StyledButton
                                    onClick={cancelForm}
                                    height="36px"
                                    style={{fontSize: "13px"}}
                                >
                                    Cancel
                                </StyledButton>
                            </InlineActions>
                        </ProductCard>
                    )}

                    <Separator />

                    <h3 style={{margin: 0}}>Bulk Credit Grant</h3>
                    <Settings style={{width: "400px"}}>
                        <FieldRow>
                            <label>Credits to Grant</label>
                            <NumericInput
                                value={bulkCredits}
                                setValue={setBulkCredits}
                                min={0}
                                width="200px"
                                height="40px"
                            />
                        </FieldRow>
                    </Settings>
                    <StyledButton
                        isBlue
                        onClick={handleBulkGrant}
                        disabled={loading || bulkCredits <= 0}
                        height="40px"
                        margin="8px 0 0"
                        style={{fontSize: "14px"}}
                    >
                        {loading ? "Granting..." : "Grant Credits to All Users"}
                    </StyledButton>
                </div>
            </AccountBox>
        </>
    );
};
