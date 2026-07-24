export const realtimeBookingTools = [
  {
    type: "function",
    name: "check_availability",
    description: "Check the live Blueridge calendar before offering appointment times. Call this for every requested date, including today, tomorrow, or a weekday.",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Requested calendar date in America/New_York, formatted YYYY-MM-DD.",
        },
        durationMins: {
          type: "integer",
          description: "Appointment length in minutes. Use 30 unless the user requests another supported length.",
        },
        timeOfDay: {
          type: "string",
          enum: ["morning", "afternoon", "any"],
          description: "The user's preferred part of the day, or any.",
        },
      },
      required: ["date"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "book_appointment",
    description: "Book a user-confirmed appointment time returned by check_availability and send the confirmation email. Collect the user's name and email before calling.",
    parameters: {
      type: "object",
      properties: {
        startISO: {
          type: "string",
          description: "Exact ISO start timestamp previously returned by check_availability.",
        },
        durationMins: {
          type: "integer",
          description: "Appointment length in minutes. Must match the availability check; normally 30.",
        },
        name: { type: "string", description: "Customer's full name." },
        email: { type: "string", description: "Customer's email address." },
        phone: { type: "string", description: "Customer's phone number, if provided." },
        notes: { type: "string", description: "Optional short booking notes." },
      },
      required: ["startISO", "name", "email"],
      additionalProperties: false,
    },
  },
] as const;
