import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'API Documentation',
      version: '1.0.0',
      description: 'Auto-generated API documentation',
    },
    servers: [
      {
        url: '/v1',
        description: 'API v1',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        // ── Common ──────────────────────────────────────────────────────────
        PaginationMeta: {
          type: 'object',
          properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
            total: { type: 'integer', example: 100 },
            totalPages: { type: 'integer', example: 5 },
          },
        },
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'object' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
          },
        },

        // ── Auth ─────────────────────────────────────────────────────────────
        RegisterInput: {
          type: 'object',
          required: ['firstName', 'lastName', 'email', 'password'],
          properties: {
            firstName: { type: 'string', maxLength: 50, example: 'John' },
            lastName: { type: 'string', maxLength: 50, example: 'Doe' },
            email: { type: 'string', format: 'email', example: 'user@example.com' },
            password: {
              type: 'string',
              minLength: 8,
              example: 'Strongpass1',
              description: 'Must contain uppercase, lowercase and a number',
            },
          },
        },
        LoginInput: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string' },
          },
        },
        RefreshTokenInput: {
          type: 'object',
          required: ['refreshToken'],
          properties: {
            refreshToken: { type: 'string' },
          },
        },
        ForgotPasswordInput: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', format: 'email' },
          },
        },
        ResetPasswordInput: {
          type: 'object',
          required: ['token', 'password'],
          properties: {
            token: { type: 'string' },
            password: { type: 'string', minLength: 8 },
          },
        },
        UpdateMeInput: {
          type: 'object',
          properties: {
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            avatarUrl: { type: 'string', format: 'uri' },
          },
        },

        // ── Users ─────────────────────────────────────────────────────────────
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            avatarUrl: { type: 'string', nullable: true },
            role: { type: 'string', enum: ['admin', 'member'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        UserDetail: {
          allOf: [
            { $ref: '#/components/schemas/User' },
            {
              type: 'object',
              properties: {
                emailVerified: { type: 'boolean' },
                enrollments: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Enrollment' },
                },
                payments: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Payment' },
                },
              },
            },
          ],
        },

        // ── Masterclasses ─────────────────────────────────────────────────────
        MasterclassStatus: {
          type: 'string',
          enum: ['draft', 'upcoming', 'active', 'completed'],
        },
        Masterclass: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            description: { type: 'string' },
            coverImageUrl: { type: 'string', nullable: true },
            priceCents: { type: 'integer', example: 9900 },
            status: { $ref: '#/components/schemas/MasterclassStatus' },
            isPublished: { type: 'boolean' },
            startsAt: { type: 'string', format: 'date-time' },
            endsAt: { type: 'string', format: 'date-time' },
            sessionsCount: { type: 'integer' },
            enrollmentsCount: { type: 'integer' },
            isEnrolled: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        AdminMasterclass: {
          allOf: [
            { $ref: '#/components/schemas/Masterclass' },
            {
              type: 'object',
              properties: {
                enrolledCount: { type: 'integer' },
                revenueCents: { type: 'integer' },
              },
            },
          ],
        },
        CreateMasterclassInput: {
          type: 'object',
          required: ['title', 'description', 'priceCents', 'startsAt', 'endsAt'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: 'string', minLength: 1 },
            coverImageUrl: { type: 'string', format: 'uri' },
            priceCents: { type: 'integer', minimum: 0 },
            status: { $ref: '#/components/schemas/MasterclassStatus' },
            startsAt: { type: 'string', format: 'date-time' },
            endsAt: { type: 'string', format: 'date-time' },
            maxEnrollments: { type: 'integer', minimum: 1 },
            isPublished: { type: 'boolean' },
          },
        },

        // ── Sessions ──────────────────────────────────────────────────────────
        SessionStatus: {
          type: 'string',
          enum: ['upcoming', 'live', 'completed'],
        },
        Session: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            description: { type: 'string', nullable: true },
            orderIndex: { type: 'integer' },
            status: { $ref: '#/components/schemas/SessionStatus' },
            scheduledAt: { type: 'string', format: 'date-time', nullable: true },
            durationSeconds: { type: 'integer', nullable: true },
            liveStreamUrl: { type: 'string', nullable: true },
          },
        },
        SessionDetail: {
          allOf: [
            { $ref: '#/components/schemas/Session' },
            {
              type: 'object',
              properties: {
                progress: { $ref: '#/components/schemas/SessionProgress' },
                prevSession: { type: 'object', nullable: true },
                nextSession: { type: 'object', nullable: true },
                playbackUrl: { type: 'string', format: 'uri', nullable: true },
                playbackUrlExpiresAt: { type: 'string', format: 'date-time', nullable: true },
                playbackType: { type: 'string', enum: ['hls', 'audio'], nullable: true },
                processingStatus: { type: 'string', enum: ['not_queued', 'queued', 'processing', 'ready', 'failed'], nullable: true },
              },
            },
          ],
        },
        CreateSessionInput: {
          type: 'object',
          required: ['title', 'orderIndex'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: 'string' },
            orderIndex: { type: 'integer', minimum: 1 },
            status: { $ref: '#/components/schemas/SessionStatus' },
            scheduledAt: { type: 'string', format: 'date-time' },
            videoStorageKey: { type: 'string', nullable: true },
            videoMediaId: { type: 'string', format: 'uuid', nullable: true },
            durationSeconds: { type: 'integer', minimum: 1 },
            liveStreamUrl: { type: 'string', format: 'uri' },
          },
        },
        SessionProgress: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', format: 'uuid' },
            lastWatchedSeconds: { type: 'integer' },
            completedAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        UpdateProgressInput: {
          type: 'object',
          required: ['lastWatchedSeconds'],
          properties: {
            lastWatchedSeconds: { type: 'number', minimum: 0 },
            completed: { type: 'boolean' },
          },
        },

        // ── Enrollments ───────────────────────────────────────────────────────
        Enrollment: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            enrolledAt: { type: 'string', format: 'date-time' },
            accessExpiresAt: { type: 'string', format: 'date-time', nullable: true },
            masterclass: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                coverImageUrl: { type: 'string', nullable: true },
                status: { $ref: '#/components/schemas/MasterclassStatus' },
                sessionsCount: { type: 'integer' },
              },
            },
            sessionsCompleted: { type: 'integer' },
            progressPct: { type: 'integer', minimum: 0, maximum: 100 },
          },
        },

        // ── Payments ──────────────────────────────────────────────────────────
        PaymentStatus: {
          type: 'string',
          enum: ['pending', 'succeeded', 'failed', 'refunded'],
        },
        Payment: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            amountCents: { type: 'integer' },
            currency: { type: 'string', example: 'usd' },
            status: { $ref: '#/components/schemas/PaymentStatus' },
            gatewayReference: { type: 'string', nullable: true },
            refundedAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            masterclass: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                coverImageUrl: { type: 'string', nullable: true },
              },
            },
          },
        },
        CreateCheckoutInput: {
          type: 'object',
          required: ['masterclassId'],
          properties: {
            masterclassId: { type: 'string', format: 'uuid' },
          successUrl: { type: 'string', format: 'uri', description: 'Optional approved frontend return URL' },
          cancelUrl: { type: 'string', format: 'uri', description: 'Optional approved frontend cancel URL' },
          },
        },
        PaymentStats: {
          type: 'object',
          properties: {
            netRevenueCents: { type: 'integer' },
            refundedCents: { type: 'integer' },
            failedCount: { type: 'integer' },
          },
        },

        // ── Inquiries ─────────────────────────────────────────────────────────
        InquiryType: { type: 'string', enum: ['general', 'booking'] },
        InquiryStatus: { type: 'string', enum: ['open', 'closed'] },
        Inquiry: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            senderName: { type: 'string' },
            senderEmail: { type: 'string', format: 'email' },
            senderPhone: { type: 'string', nullable: true },
            type: { $ref: '#/components/schemas/InquiryType' },
            subject: { type: 'string', nullable: true },
            message: { type: 'string' },
            status: { $ref: '#/components/schemas/InquiryStatus' },
            adminReply: { type: 'string', nullable: true },
            repliedAt: { type: 'string', format: 'date-time', nullable: true },
            handledAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        SubmitInquiryInput: {
          type: 'object',
          required: ['senderName', 'senderEmail', 'type', 'message'],
          properties: {
            senderName: { type: 'string', minLength: 1, maxLength: 255 },
            senderEmail: { type: 'string', format: 'email' },
            senderPhone: { type: 'string' },
            type: { $ref: '#/components/schemas/InquiryType' },
            subject: { type: 'string' },
            message: { type: 'string', minLength: 1 },
          },
        },
        ReplyInquiryInput: {
          type: 'object',
          required: ['replyText'],
          properties: {
            replyText: { type: 'string', minLength: 1 },
          },
        },

        // ── Quotes ────────────────────────────────────────────────────────────
        QuoteStatus: {
          type: 'string',
          enum: ['new', 'reviewing', 'quoted', 'booked', 'closed'],
        },
        Quote: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            serviceId: { type: 'string', format: 'uuid' },
            clientName: { type: 'string' },
            clientEmail: { type: 'string', format: 'email' },
            clientPhone: { type: 'string', nullable: true },
            eventDate: { type: 'string', format: 'date-time', nullable: true },
            eventType: { type: 'string', nullable: true },
            location: { type: 'string', nullable: true },
            durationNotes: { type: 'string', nullable: true },
            budgetMinCents: { type: 'integer', nullable: true },
            budgetMaxCents: { type: 'integer', nullable: true },
            projectNotes: { type: 'string', nullable: true },
            status: { $ref: '#/components/schemas/QuoteStatus' },
            adminNotes: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        SubmitQuoteInput: {
          type: 'object',
          required: ['serviceId', 'clientName', 'clientEmail'],
          properties: {
            serviceId: { type: 'string', format: 'uuid' },
            clientName: { type: 'string', minLength: 1 },
            clientEmail: { type: 'string', format: 'email' },
            clientPhone: { type: 'string' },
            eventDate: { type: 'string', format: 'date-time' },
            eventType: { type: 'string' },
            location: { type: 'string' },
            durationNotes: { type: 'string' },
            budgetMinCents: { type: 'integer', minimum: 1 },
            budgetMaxCents: { type: 'integer', minimum: 1 },
            projectNotes: { type: 'string' },
          },
        },
        UpdateQuoteStatusInput: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { $ref: '#/components/schemas/QuoteStatus' },
            adminNotes: { type: 'string' },
          },
        },

        // ── Services ──────────────────────────────────────────────────────────
        Service: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            slug: { type: 'string' },
            title: { type: 'string' },
            tagline: { type: 'string', nullable: true },
            description: { type: 'string', nullable: true },
            coverImageUrl: { type: 'string', nullable: true },
            isPublished: { type: 'boolean' },
            orderIndex: { type: 'integer' },
          },
        },
        CreateServiceInput: {
          type: 'object',
          required: ['slug', 'title', 'orderIndex'],
          properties: {
            slug: { type: 'string', minLength: 1, maxLength: 100 },
            title: { type: 'string', minLength: 1 },
            tagline: { type: 'string' },
            description: { type: 'string' },
            coverImageUrl: { type: 'string', format: 'uri' },
            isPublished: { type: 'boolean' },
            orderIndex: { type: 'integer' },
          },
        },

        // ── Events ────────────────────────────────────────────────────────────
        Event: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            description: { type: 'string', nullable: true },
            eventDate: { type: 'string', format: 'date-time' },
            location: { type: 'string', nullable: true },
            isPublished: { type: 'boolean' },
          },
        },
        CreateEventInput: {
          type: 'object',
          required: ['title', 'eventDate'],
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            eventDate: { type: 'string', format: 'date-time' },
            location: { type: 'string' },
            isPublished: { type: 'boolean' },
          },
        },

        // ── Testimonials ──────────────────────────────────────────────────────
        Testimonial: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            quote: { type: 'string' },
            authorName: { type: 'string' },
            authorOrg: { type: 'string', nullable: true },
            avatarUrl: { type: 'string', nullable: true },
            isFeatured: { type: 'boolean' },
            orderIndex: { type: 'integer' },
          },
        },
        CreateTestimonialInput: {
          type: 'object',
          required: ['quote', 'authorName', 'orderIndex'],
          properties: {
            quote: { type: 'string', minLength: 1 },
            authorName: { type: 'string', minLength: 1, maxLength: 255 },
            authorOrg: { type: 'string' },
            avatarUrl: { type: 'string', format: 'uri' },
            isFeatured: { type: 'boolean' },
            orderIndex: { type: 'integer' },
          },
        },

        // ── Media ─────────────────────────────────────────────────────────────
        FileType: {
          type: 'string',
          enum: ['image', 'audio', 'video', 'document', 'archive'],
        },
        MediaItem: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            storageKey: { type: 'string', description: 'Admin responses only' },
            isPublic: { type: 'boolean' },
            filename: { type: 'string' },
            mimeType: { type: 'string' },
            fileType: { $ref: '#/components/schemas/FileType' },
            processingStatus: { type: 'string', enum: ['not_queued', 'queued', 'processing', 'ready', 'failed'] },
            sizeBytes: { type: 'string', pattern: '^[0-9]+$', description: 'Decimal byte count' },
            url: { type: 'string', format: 'uri' },
            uploadedBy: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        // ── Dashboard ─────────────────────────────────────────────────────────
        DashboardStats: {
          type: 'object',
          properties: {
            totalUsers: { type: 'integer' },
            totalMasterclasses: { type: 'integer' },
            totalEnrollments: { type: 'integer' },
            netRevenueCents: { type: 'integer' },
            refundedCents: { type: 'integer' },
            failedPayments: { type: 'integer' },
          },
        },

        // ── Settings ──────────────────────────────────────────────────────────
        SettingsMap: {
          type: 'object',
          additionalProperties: { type: 'string' },
          example: {
            contact_email: 'hello@example.com',
            contact_phone_1: '+1234567890',
            social_facebook: 'https://facebook.com/example',
          },
        },
      },
    },
    paths: {
      // ════════════════════════════════════════════════════════════════════════
      // AUTH
      // ════════════════════════════════════════════════════════════════════════
      '/auth/register': {
        post: {
          tags: ['Auth'],
          summary: 'Register a new user',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterInput' } } },
          },
          responses: {
            201: { description: 'User registered successfully' },
            400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            429: { description: 'Rate limit exceeded' },
          },
        },
      },
      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Login and receive tokens',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginInput' } } },
          },
          responses: {
            200: { description: 'Login successful — returns access & refresh tokens' },
            401: { description: 'Invalid credentials' },
            429: { description: 'Rate limit exceeded' },
          },
        },
      },
      '/auth/refresh': {
        post: {
          tags: ['Auth'],
          summary: 'Refresh access token',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RefreshTokenInput' } } },
          },
          responses: {
            200: { description: 'New access token returned' },
            401: { description: 'Invalid or expired refresh token' },
          },
        },
      },
      '/auth/logout': {
        post: {
          tags: ['Auth'],
          summary: 'Logout the current user',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'Logged out successfully' },
          },
        },
      },
      '/auth/forgot-password': {
        post: {
          tags: ['Auth'],
          summary: 'Request a password reset email',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ForgotPasswordInput' } } },
          },
          responses: {
            200: { description: 'Reset email sent (if account exists)' },
            429: { description: 'Rate limit exceeded' },
          },
        },
      },
      '/auth/reset-password': {
        post: {
          tags: ['Auth'],
          summary: 'Reset password using a token',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ResetPasswordInput' } } },
          },
          responses: {
            200: { description: 'Password reset successful' },
            400: { description: 'Invalid or expired token' },
            429: { description: 'Rate limit exceeded' },
          },
        },
      },
      '/auth/me': {
        get: {
          tags: ['Auth'],
          summary: 'Get the current authenticated user',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'Current user profile', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
            401: { description: 'Unauthorized' },
          },
        },
        patch: {
          tags: ['Auth'],
          summary: 'Update the current user profile',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateMeInput' } } },
          },
          responses: {
            200: { description: 'User updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
            401: { description: 'Unauthorized' },
          },
        },
      },

      // ════════════════════════════════════════════════════════════════════════
      // USERS  (admin)
      // ════════════════════════════════════════════════════════════════════════
      '/users': {
        get: {
          tags: ['Users'],
          summary: 'List all users (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'q', in: 'query', description: 'Search by name or email', schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            200: {
              description: 'Paginated list of users',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/User' } },
                      meta: { $ref: '#/components/schemas/PaginationMeta' },
                    },
                  },
                },
              },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden — admin only' },
          },
        },
      },
      '/users/{id}': {
        get: {
          tags: ['Users'],
          summary: 'Get a single user with enrollments & payments (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'User detail', content: { 'application/json': { schema: { $ref: '#/components/schemas/UserDetail' } } } },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden — admin only' },
            404: { description: 'User not found' },
          },
        },
      },

      // ════════════════════════════════════════════════════════════════════════
      // MASTERCLASSES  (public / member)
      // ════════════════════════════════════════════════════════════════════════
      '/masterclasses': {
        get: {
          tags: ['Masterclasses'],
          summary: 'List published masterclasses',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Array of masterclasses with enrollment status',
              content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Masterclass' } } } },
            },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/masterclasses/{id}': {
        get: {
          tags: ['Masterclasses'],
          summary: 'Get a single masterclass with sessions and progress',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Masterclass detail' },
            401: { description: 'Unauthorized' },
            404: { description: 'Not found' },
          },
        },
      },
      '/masterclasses/{id}/sessions': {
        get: {
          tags: ['Masterclasses'],
          summary: 'List sessions for a masterclass',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Array of sessions', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Session' } } } } },
            401: { description: 'Unauthorized' },
          },
        },
      },

      // ════════════════════════════════════════════════════════════════════════
      // MASTERCLASSES  (admin)
      // ════════════════════════════════════════════════════════════════════════
      '/admin/masterclasses': {
        get: {
          tags: ['Admin — Masterclasses'],
          summary: 'List all masterclasses with revenue & enrollment stats (admin)',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'Array of admin masterclass objects', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/AdminMasterclass' } } } } },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
        post: {
          tags: ['Admin — Masterclasses'],
          summary: 'Create a masterclass (admin)',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateMasterclassInput' } } },
          },
          responses: {
            201: { description: 'Masterclass created' },
            400: { description: 'Validation error' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },
      '/admin/masterclasses/{id}': {
        patch: {
          tags: ['Admin — Masterclasses'],
          summary: 'Update a masterclass (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateMasterclassInput' } } },
          },
          responses: {
            200: { description: 'Updated masterclass' },
            400: { description: 'Validation error' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
        delete: {
          tags: ['Admin — Masterclasses'],
          summary: 'Soft-delete (unpublish) a masterclass (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Masterclass unpublished' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },
      '/admin/masterclasses/{id}/enrollments': {
        get: {
          tags: ['Admin — Masterclasses'],
          summary: 'List enrollments for a masterclass (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Array of enrollments with user and payment info' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
            404: { description: 'Masterclass not found' },
          },
        },
      },
      '/admin/masterclasses/{id}/sessions': {
        post: {
          tags: ['Admin — Masterclasses'],
          summary: 'Add a session to a masterclass (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateSessionInput' } } },
          },
          responses: {
            201: { description: 'Session created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Session' } } } },
            400: { description: 'Validation error' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
            404: { description: 'Masterclass not found' },
          },
        },
      },
      '/admin/masterclasses/sessions/{sessionId}': {
        patch: {
          tags: ['Admin — Masterclasses'],
          summary: 'Update a session (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateSessionInput' } } },
          },
          responses: {
            200: { description: 'Updated session' },
            400: { description: 'Validation error' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
        delete: {
          tags: ['Admin — Masterclasses'],
          summary: 'Delete a session (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Session deleted' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },

      // ════════════════════════════════════════════════════════════════════════
      // SESSIONS  (member)
      // ════════════════════════════════════════════════════════════════════════
      '/sessions/{id}': {
        get: {
          tags: ['Sessions'],
          summary: 'Get a session with playback info and user progress (enrolled members only)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Session detail', content: { 'application/json': { schema: { $ref: '#/components/schemas/SessionDetail' } } } },
            401: { description: 'Unauthorized' },
            403: { description: 'Not enrolled' },
            404: { description: 'Session not found' },
          },
        },
      },
      '/sessions/{id}/progress': {
        post: {
          tags: ['Sessions'],
          summary: 'Update watch progress for a session (enrolled members only)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateProgressInput' } } },
          },
          responses: {
            200: { description: 'Progress saved', content: { 'application/json': { schema: { $ref: '#/components/schemas/SessionProgress' } } } },
            400: { description: 'Invalid lastWatchedSeconds' },
            401: { description: 'Unauthorized' },
            403: { description: 'Not enrolled' },
          },
        },
      },

      // ════════════════════════════════════════════════════════════════════════
      // ENROLLMENTS
      // ════════════════════════════════════════════════════════════════════════
      '/enrollments/my': {
        get: {
          tags: ['Enrollments'],
          summary: 'Get the current user\'s enrollments with progress',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'Array of enrollments', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Enrollment' } } } } },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/enrollments/admin/masterclass/{masterclassId}': {
        get: {
          tags: ['Enrollments'],
          summary: 'Get enrollments for a specific masterclass (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'masterclassId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Array of enrollments with user and payment info' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },

      // ════════════════════════════════════════════════════════════════════════
      // PAYMENTS  (member)
      // ════════════════════════════════════════════════════════════════════════
      '/payments/checkout': {
        post: {
          tags: ['Payments'],
          summary: 'Create a checkout session for a masterclass',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateCheckoutInput' } } },
          },
          responses: {
            200: { description: 'Hosted checkout initiated (returns checkoutUrl, sessionId, paymentId, amountCents and currency)' },
            400: { description: 'Invalid input or unapproved return URL' },
            409: { description: 'Already enrolled, full, closed or expired checkout' },
            401: { description: 'Unauthorized' },
            404: { description: 'Masterclass not found' },
          },
        },
      },
      '/payments/my': {
        get: {
          tags: ['Payments'],
          summary: 'Get the current user\'s payment history',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'Array of payments', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Payment' } } } } },
            401: { description: 'Unauthorized' },
          },
        },
      },
      '/payments/webhook': {
        post: {
          tags: ['Payments'],
          summary: 'Stripe webhook receiver',
          description: 'Receives raw Stripe webhook events. Must use raw body — do not send JSON.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: {
            200: { description: 'Acknowledged' },
            400: { description: 'Webhook signature verification failed' },
          },
        },
      },

      // ════════════════════════════════════════════════════════════════════════
      // PAYMENTS  (admin)
      // ════════════════════════════════════════════════════════════════════════
      '/admin/payments': {
        get: {
          tags: ['Admin — Payments'],
          summary: 'List payments with filters and aggregate stats (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'status', in: 'query', schema: { $ref: '#/components/schemas/PaymentStatus' } },
            { name: 'from', in: 'query', description: 'ISO date string', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', description: 'ISO date string', schema: { type: 'string', format: 'date-time' } },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            200: {
              description: 'Paginated payments with stats',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      payments: { type: 'array', items: { $ref: '#/components/schemas/Payment' } },
                      stats: { $ref: '#/components/schemas/PaymentStats' },
                      meta: { $ref: '#/components/schemas/PaginationMeta' },
                    },
                  },
                },
              },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },
      '/admin/payments/{id}/refund': {
        post: {
          tags: ['Admin — Payments'],
          summary: 'Refund a payment (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Refund initiated' },
            400: { description: 'Payment is not in succeeded state' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
            404: { description: 'Payment not found' },
          },
        },
      },
      '/admin/payments/export/csv': {
        get: {
          tags: ['Admin — Payments'],
          summary: 'Export payments as CSV (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: {
            200: {
              description: 'CSV file download',
              content: { 'text/csv': { schema: { type: 'string' } } },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },

      // ════════════════════════════════════════════════════════════════════════
      // INQUIRIES
      // ════════════════════════════════════════════════════════════════════════
      '/inquiries': {
        post: {
          tags: ['Inquiries'],
          summary: 'Submit a public inquiry',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SubmitInquiryInput' } } },
          },
          responses: {
            201: { description: 'Inquiry submitted', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } } } } } },
            400: { description: 'Validation error' },
          },
        },
        get: {
          tags: ['Inquiries'],
          summary: 'List all inquiries (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'status', in: 'query', schema: { $ref: '#/components/schemas/InquiryStatus' } },
            { name: 'sort', in: 'query', schema: { type: 'string', enum: ['newest', 'oldest'] } },
          ],
          responses: {
            200: { description: 'Array of inquiries', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Inquiry' } } } } },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },
      '/inquiries/{id}': {
        get: {
          tags: ['Inquiries'],
          summary: 'Get a single inquiry (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Inquiry detail', content: { 'application/json': { schema: { $ref: '#/components/schemas/Inquiry' } } } },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
            404: { description: 'Not found' },
          },
        },
      },
      '/inquiries/{id}/reply': {
        post: {
          tags: ['Inquiries'],
          summary: 'Reply to an inquiry by email and close it (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ReplyInquiryInput' } } },
          },
          responses: {
            200: { description: 'Inquiry replied and closed' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
            404: { description: 'Not found' },
          },
        },
      },
      '/inquiries/{id}/handle': {
        patch: {
          tags: ['Inquiries'],
          summary: 'Mark an inquiry as handled / closed without replying (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Inquiry closed' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },

      // ════════════════════════════════════════════════════════════════════════
      // QUOTES
      // ════════════════════════════════════════════════════════════════════════
      '/quotes': {
        post: {
          tags: ['Quotes'],
          summary: 'Submit a public quote request',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SubmitQuoteInput' } } },
          },
          responses: {
            201: { description: 'Quote request submitted', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } } } } } },
            400: { description: 'Validation error' },
          },
        },
        get: {
          tags: ['Quotes'],
          summary: 'List all quote requests (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'status', in: 'query', schema: { $ref: '#/components/schemas/QuoteStatus' } },
          ],
          responses: {
            200: { description: 'Array of quote requests', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Quote' } } } } },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },
      '/quotes/{id}': {
        get: {
          tags: ['Quotes'],
          summary: 'Get a single quote request (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Quote detail with service info', content: { 'application/json': { schema: { $ref: '#/components/schemas/Quote' } } } },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
            404: { description: 'Not found' },
          },
        },
      },
      '/quotes/{id}/status': {
        patch: {
          tags: ['Quotes'],
          summary: 'Update the status of a quote request (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateQuoteStatusInput' } } },
          },
          responses: {
            200: { description: 'Quote updated' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },

      // ════════════════════════════════════════════════════════════════════════
      // SERVICES
      // ════════════════════════════════════════════════════════════════════════
      '/services': {
        get: {
          tags: ['Services'],
          summary: 'List all published services',
          responses: {
            200: { description: 'Array of services', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Service' } } } } },
          },
        },
        post: {
          tags: ['Services'],
          summary: 'Create a service (admin)',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateServiceInput' } } },
          },
          responses: {
            201: { description: 'Service created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Service' } } } },
            400: { description: 'Validation error' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },
      '/services/{slug}': {
        get: {
          tags: ['Services'],
          summary: 'Get a service by slug',
          parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Service with related services' },
            404: { description: 'Service not found' },
          },
        },
      },
      '/services/{id}': {
        patch: {
          tags: ['Services'],
          summary: 'Update a service (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateServiceInput' } } },
          },
          responses: {
            200: { description: 'Service updated' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
        delete: {
          tags: ['Services'],
          summary: 'Delete a service (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Service deleted' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },

      // ════════════════════════════════════════════════════════════════════════
      // EVENTS
      // ════════════════════════════════════════════════════════════════════════
      '/events': {
        get: {
          tags: ['Events'],
          summary: 'List upcoming published events',
          responses: {
            200: { description: 'Array of events', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Event' } } } } },
          },
        },
        post: {
          tags: ['Events'],
          summary: 'Create an event (admin)',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateEventInput' } } },
          },
          responses: {
            201: { description: 'Event created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Event' } } } },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },
      '/events/{id}': {
        patch: {
          tags: ['Events'],
          summary: 'Update an event (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateEventInput' } } },
          },
          responses: {
            200: { description: 'Event updated' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
        delete: {
          tags: ['Events'],
          summary: 'Delete an event (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Event deleted' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },

      // ════════════════════════════════════════════════════════════════════════
      // TESTIMONIALS
      // ════════════════════════════════════════════════════════════════════════
      '/testimonials': {
        get: {
          tags: ['Testimonials'],
          summary: 'List testimonials',
          parameters: [
            { name: 'featured', in: 'query', description: 'Pass "true" to return only featured testimonials', schema: { type: 'string', enum: ['true', 'false'] } },
          ],
          responses: {
            200: { description: 'Array of testimonials', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Testimonial' } } } } },
          },
        },
        post: {
          tags: ['Testimonials'],
          summary: 'Create a testimonial (admin)',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateTestimonialInput' } } },
          },
          responses: {
            201: { description: 'Testimonial created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Testimonial' } } } },
            400: { description: 'Validation error' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },
      '/testimonials/{id}': {
        patch: {
          tags: ['Testimonials'],
          summary: 'Update a testimonial (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateTestimonialInput' } } },
          },
          responses: {
            200: { description: 'Testimonial updated' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
        delete: {
          tags: ['Testimonials'],
          summary: 'Delete a testimonial (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Testimonial deleted' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },

      // ════════════════════════════════════════════════════════════════════════
      // MEDIA
      // ════════════════════════════════════════════════════════════════════════
      '/media': {
        get: {
          tags: ['Media'],
          summary: 'List media library items (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'q', in: 'query', description: 'Search by filename', schema: { type: 'string' } },
            { name: 'type', in: 'query', schema: { $ref: '#/components/schemas/FileType' } },
          ],
          responses: {
            200: { description: 'Array of media items', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/MediaItem' } } } } },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },
      '/media/upload': {
        post: {
          tags: ['Media'],
          summary: 'Upload a file to the media library (admin)',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file'],
                  properties: {
                    file: {
                      type: 'string',
                      format: 'binary',
                      description: 'Max 50 MB. Allowed types: image/*, audio/*, video/mp4, video/quicktime, application/pdf, application/zip, text/plain',
                    },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'File uploaded', content: { 'application/json': { schema: { $ref: '#/components/schemas/MediaItem' } } } },
            400: { description: 'No file provided or unsupported file type' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },
      '/media/{id}': {
        delete: {
          tags: ['Media'],
          summary: 'Delete a media item from the library and storage (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Media item deleted' },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
            404: { description: 'Not found' },
            500: { description: 'Storage deletion failed' },
          },
        },
      },

      // ════════════════════════════════════════════════════════════════════════
      // SETTINGS
      // ════════════════════════════════════════════════════════════════════════
      '/settings/public': {
        get: {
          tags: ['Settings'],
          summary: 'Get public site settings (contact info, social links)',
          responses: {
            200: { description: 'Key-value settings map', content: { 'application/json': { schema: { $ref: '#/components/schemas/SettingsMap' } } } },
          },
        },
      },
      '/settings': {
        get: {
          tags: ['Settings'],
          summary: 'Get all settings (admin)',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'All key-value settings', content: { 'application/json': { schema: { $ref: '#/components/schemas/SettingsMap' } } } },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
        patch: {
          tags: ['Settings'],
          summary: 'Upsert one or more settings (admin)',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SettingsMap' } } },
          },
          responses: {
            200: { description: 'All settings after update', content: { 'application/json': { schema: { $ref: '#/components/schemas/SettingsMap' } } } },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden' },
          },
        },
      },

      // ════════════════════════════════════════════════════════════════════════
      // DASHBOARD
      // ════════════════════════════════════════════════════════════════════════
      '/dashboard': {
        get: {
          tags: ['Dashboard'],
          summary: 'Get admin dashboard stats, recent payments, inquiries and active masterclasses',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Dashboard data',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      stats: { $ref: '#/components/schemas/DashboardStats' },
                      recentPayments: { type: 'array', items: { $ref: '#/components/schemas/Payment' } },
                      recentInquiries: { type: 'array', items: { $ref: '#/components/schemas/Inquiry' } },
                      activeMasterclasses: { type: 'array', items: { $ref: '#/components/schemas/AdminMasterclass' } },
                    },
                  },
                },
              },
            },
            401: { description: 'Unauthorized' },
            403: { description: 'Forbidden — admin only' },
          },
        },
      },
    },
    tags: [
      { name: 'Auth', description: 'Registration, login, token refresh, password reset' },
      { name: 'Users', description: 'User management (admin)' },
      { name: 'Masterclasses', description: 'Published masterclasses for authenticated members' },
      { name: 'Admin — Masterclasses', description: 'Full masterclass and session CRUD (admin)' },
      { name: 'Sessions', description: 'Session playback and progress tracking (enrolled members)' },
      { name: 'Enrollments', description: 'Enrollment access and listing' },
      { name: 'Payments', description: 'Checkout, webhooks, and payment history' },
      { name: 'Admin — Payments', description: 'Payment listing, refunds, and CSV export (admin)' },
      { name: 'Inquiries', description: 'Public inquiry form and admin management' },
      { name: 'Quotes', description: 'Public quote requests and admin management' },
      { name: 'Services', description: 'Service pages (public read, admin write)' },
      { name: 'Events', description: 'Upcoming events (public read, admin write)' },
      { name: 'Testimonials', description: 'Testimonials (public read, admin write)' },
      { name: 'Media', description: 'Media library management (admin)' },
      { name: 'Settings', description: 'Site settings (public read for safe keys, admin write)' },
      { name: 'Dashboard', description: 'Admin dashboard overview' },
    ],
  },
  apis: [], // All paths are defined inline above
};

const videoPaths = (options.definition as unknown as { paths: Record<string, unknown> }).paths;
Object.assign(videoPaths, {
  '/admin/media/{id}/transcode': {
    get: { tags: ['Media'], summary: 'Inspect private video processing status', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Processing status, attempts, duration, renditions and safe error code' }, 404: { description: 'Video not found' } } },
    post: { tags: ['Media'], summary: 'Queue an existing private video or retry a failed encode', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: false } } } }, responses: { 200: { description: 'Queued' }, 409: { description: 'Already ready or actively processing' } } },
  },
  '/playback/{mediaId}/{asset}': {
    get: { tags: ['Sessions'], summary: 'Read a protected HLS playlist or redirect a segment to private S3', description: 'Use the playbackUrl returned by the authenticated session or resource endpoint. Every request rechecks the viewer and enrollment. No main bearer token is required when the signed playback token is present.', parameters: [{ name: 'mediaId', in: 'path', required: true, schema: { type: 'string' } }, { name: 'asset', in: 'path', required: true, schema: { type: 'string', example: '360p/index.m3u8' } }, { name: 'token', in: 'query', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Rewritten HLS playlist', content: { 'application/vnd.apple.mpegurl': { schema: { type: 'string' } } } }, 302: { description: 'Private segment link, valid for at most 60 seconds' }, 401: { description: 'Invalid, expired or revoked token' }, 403: { description: 'Enrollment or attachment does not authorize playback' }, 409: { description: 'Video not ready' } } },
  },
});
export const swaggerSpec = swaggerJsdoc(options);
