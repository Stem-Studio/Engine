import { describe, expect, it } from "vitest";

import { parsePascalPlanCadCatalogSource } from "./planCadPascalCatalog";

describe("planCadPascalCatalog", () => {
    it("parses Pascal item metadata into BIM part catalogs", () => {
        const source = `
            import type { AssetInput } from '@pascal-app/core'

            export const CATALOG_ITEMS: AssetInput[] = [
              {
                id: 'sofa',
                category: 'furniture',
                name: 'Sofa',
                tags: ['seating', 'fabric'],
                thumbnail: 'https://example.com/sofa/thumbnail.png',
                src: 'https://example.com/sofa/model.glb',
                dimensions: [2.4, 0.8, 1.1],
                offset: [0.01, 0, -0.02],
                rotation: [0, 0, 0],
                scale: [1, 1, 1],
              },
              {
                id: 'ceiling-light',
                category: 'appliance',
                name: 'Ceiling Light',
                tags: ['lighting', 'metal'],
                thumbnail: 'https://example.com/light/thumbnail.png',
                src: 'https://example.com/light/model.glb',
                dimensions: [0.35, 0.1, 0.35],
                offset: [0, 0, 0],
                rotation: [0, 0, 0],
                scale: [1, 1, 1],
                attachTo: 'ceiling',
              },
            ]

            export function getDefaultCatalogItem() { return null }
        `;

        const catalogs = parsePascalPlanCadCatalogSource(source);
        const presets = catalogs.flatMap((category) => category.presets);

        expect(catalogs.map((category) => category.id)).toEqual([
            "pascal-appliance",
            "pascal-furniture",
        ]);
        expect(presets).toHaveLength(2);
        expect(presets.find((preset) => preset.id === "pascal-sofa")).toMatchObject({
            label: "Pascal Sofa",
            placement: "floor",
            dimensions: { x: 2.4, y: 0.8, z: 1.1 },
            material: "fabric",
            source: {
                type: "model",
                provider: "pascal",
                providerAssetId: "sofa",
                url: "https://example.com/sofa/model.glb",
                transform: {
                    offset: { x: 0.01, y: 0, z: -0.02 },
                    rotation: { x: 0, y: 0, z: 0 },
                    scale: { x: 1, y: 1, z: 1 },
                },
            },
        });
        expect(presets.find((preset) => preset.id === "pascal-ceiling-light")).toMatchObject({
            placement: "ceiling",
            material: "metal",
        });
    });
});
