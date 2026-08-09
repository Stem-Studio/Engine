import z from 'zod/v3';

export const makeMetadataSchema = (name: string) => z.object({
    metadata: z.object({
        generator: z.literal(name),
    }),
});
