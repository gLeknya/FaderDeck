const { z } = require('zod');

const channelSchema = z
  .object({
    id: z.union([z.number(), z.string()]).optional(),
    app: z.string().optional(),
    appName: z.string().optional(),
    title: z.string().optional(),
    faderCC: z.number().nullable().optional(),
    faderMapping: z.unknown().optional(),
    volume: z.number().optional(),
    buttons: z.array(z.unknown()).optional(),
    skipBinding: z.boolean().optional(),
    showBindHint: z.boolean().optional(),
    flashOnCreate: z.boolean().optional()
  })
  .passthrough();

const profileSchema = z
  .object({
    version: z.union([z.number(), z.string()]).optional(),
    meta: z
      .object({
        name: z.string().optional(),
        createdAt: z.string().optional(),
        updatedAt: z.string().optional()
      })
      .passthrough()
      .optional(),
    channels: z.array(channelSchema).optional(),
    standaloneButtons: z.array(z.unknown()).optional(),
    bindings: z
      .object({
        faders: z.array(z.unknown()).optional(),
        buttons: z.array(z.unknown()).optional()
      })
      .passthrough()
      .optional(),
    audio: z
      .object({
        assignments: z.array(z.unknown()).optional()
      })
      .passthrough()
      .optional(),
    settings: z
      .object({
        midiInputId: z.string().nullable().optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

function formatValidationError(error) {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'profile';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function validateProfileData(profile) {
  const result = profileSchema.safeParse(profile);

  if (!result.success) {
    return {
      success: false,
      error: formatValidationError(result.error)
    };
  }

  return {
    success: true,
    data: result.data
  };
}

module.exports = {
  profileSchema,
  validateProfileData
};
