// 1. Dummy Durable Object class to satisfy Cloudflare's existing storage requirement
export class WorkflowStatusDO {
  state: any;
  env: any;
  constructor(state: any, env: any) {
    this.state = state;
    this.env = env;
  }
  async fetch() {
    return new Response("OK");
  }
}

// 2. Your actual FreeScout -> Notion Webhook Worker
export default {
  async fetch(request: Request, env: any): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const payload: any = await request.json();

      // Filter: Only process emails coming from Mailbox #6
      if (env.TARGET_MAILBOX_ID && String(payload.mailboxId) !== String(env.TARGET_MAILBOX_ID)) {
        return new Response("Ignored: Email belongs to another mailbox", { status: 200 });
      }

      // Extract details sent by FreeScout webhook
      const ticketSubject = payload.subject || "No Subject";
      const ticketId = payload.id || "";
      const ticketNumber = payload.number || "";
      
      // Get tags if attached in FreeScout
      const tags = payload.tags || []; 
      const notionTags = tags.map((t: any) => ({ name: typeof t === 'string' ? t : t.name }));

      // Build direct link: https://phoenix.chemwatch.net/mailbox/6/238
      const freeScoutDomain = env.FREESCOUT_DOMAIN || "https://phoenix.chemwatch.net";
      const mailboxId = payload.mailboxId || env.TARGET_MAILBOX_ID || "6";
      const ticketUrl = `${freeScoutDomain}/mailbox/${mailboxId}/${ticketId}`;

      // Build Notion API payload
      const notionProperties: any = {
        "Task Name": {
          title: [{ text: { content: `[Ticket #${ticketNumber}] ${ticketSubject}` } }]
        },
        "FreeScout Link": {
          url: ticketUrl
        },
        "Status": {
          status: { name: "Not started" }
        }
      };

      if (notionTags.length > 0) {
        notionProperties["Tag"] = {
          multi_select: notionTags
        };
      }

      // Send to Notion API
      const notionResponse = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.NOTION_API_KEY}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28"
        },
        body: JSON.stringify({
          parent: { database_id: env.NOTION_DATABASE_ID },
          properties: notionProperties
        })
      });

      if (!notionResponse.ok) {
        const errorText = await notionResponse.text();
        return new Response(`Notion API Error: ${errorText}`, { status: 500 });
      }

      return new Response("Task successfully added to Notion!", { status: 200 });

    } catch (err: any) {
      return new Response(`Worker Error: ${err.message}`, { status: 500 });
    }
  }
};
