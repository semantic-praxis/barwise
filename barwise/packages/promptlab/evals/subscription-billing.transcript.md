Facilitator: We're recording, in the sense that I'm typing. Sam said he'd join at half past, he's got the board pack to finish. Priya, Tom, shall we start without him?

Priya (Billing Operations Manager): We'll have to. If we wait for Sam we'll wait all day.

Tom (Product Manager): He'll contradict everything we say when he arrives anyway.

Facilitator: Then let's get far enough that he has something to contradict. The goal is to write down how subscriptions actually work -- what a subscription is, what it's attached to, what changes over time. I want the rules as they are. If the system does something daft, tell me it does something daft.

Priya: How long have you got.

Facilitator: An hour. Priya, you're closest to the money. Start.

Priya: Right, so. A customer signs up, they pick a plan, we create a subscription, and from then on they get billed on a cycle until they stop. That's the whole thing in one sentence and every word in it is doing more work than it looks like.

Facilitator: Unpack "customer" first. What is a customer in the system?

Priya: An account. Every account has an account number. That's what everything hangs off.

Facilitator: Is the account number the identifier?

Priya: Yes. Six digits, sequential, never reused. If an account closes and the same company comes back, they get a new number and we treat them as a new customer for reporting.

Tom: Which drives me mad, incidentally, because from a product perspective it's the same company and we lose the history.

Priya: It drives finance the other way. If we reused numbers, revenue recognition would be a nightmare.

Facilitator: Understood, but it's the rule. Account number, unique, never reused. Is there anything else that identifies an account? Email, company name?

Priya: Company name absolutely not, we have four accounts called "Acme." Email is on the contact, not the account.

Facilitator: Good. Now, subscription. What is one?

Priya: A subscription is the agreement that this account pays us this amount on this cycle for this thing. It's got a subscription ID.

Facilitator: Which is unique?

Priya: Unique. Generated, prefixed with SUB.

Facilitator: How many subscriptions can an account have?

Priya: One.

Facilitator: One, ever?

Priya: One active one.

Facilitator: Those are different answers. Which is it?

Priya: ...Let me be careful, because I nearly told you something wrong. An account has one active subscription. That was true when we only sold one product. We now sell three, and an account can have a subscription to each of them at once. So it's one active subscription per account per product.

Facilitator: Per account per product. Can they have two active subscriptions to the same product?

Priya: No. The system blocks it. That was a very expensive lesson.

Tom: The Halloway thing.

Priya: The Halloway thing.

Facilitator: Go on, if it's instructive.

Priya: A customer -- Halloway Group -- had someone in their finance team and someone in their engineering team both sign up for the analytics product, on the same account, three weeks apart. Different plans. We billed them twice for eight months and neither of them noticed because the invoices went to different cost centres. When they did notice, we refunded the lot and it was about sixty thousand.

Tom: And that's when the constraint went in.

Priya: One active subscription per account per product, enforced at the database level. Yes.

Facilitator: Good, that's clear and I'll write it down exactly that way. And products -- how are they identified?

Tom: Product code. We have three: CORE, ANALYTICS, and CONNECT.

Facilitator: Fixed at three?

Tom: Fixed today. There's a fourth in discovery, but I'm not going to pretend I know what it is.

Facilitator: Fine. Now, plan. You both used the word. Priya, what's a plan?

Priya: The price plan. It's got a plan code, it says what the customer pays and how often. CORE-MO-49, CORE-AN-490, that kind of thing.

Tom: That's not what I mean by plan at all.

Facilitator: Say what you mean.

Tom: When I say plan I mean what the customer gets. Starter, Professional, Enterprise. It's the feature bundle -- how many seats, whether they get the API, whether they get SSO. It's the thing on the pricing page.

Priya: And I mean the billing artefact. The thing that generates the invoice line.

Facilitator: So we've got two things both called plan.

Tom: We've got two things both called plan, and the sales team calls a third thing a plan, which is the deal they negotiated, which frequently matches neither.

Priya: Don't. That's a different meeting.

Facilitator: I'm going to hold this one open because I don't think we've got to the bottom of it, and come back. Let's do the mechanical bits first. Priya, a subscription -- what's on it?

Priya: Subscription ID. The account. The product. The price plan. Start date. End date, sometimes. Billing period. Status.

Facilitator: End date sometimes?

Priya: An open-ended subscription has no end date. Most of them are open-ended -- they run until cancelled. A fixed-term one has an end date agreed up front, that's usually an enterprise deal.

Facilitator: So end date is optional and start date isn't.

Priya: Start date is always there. You can't create a subscription without one, the form won't submit.

Facilitator: Billing period -- what are the values?

Priya: Monthly or annual.

Facilitator: Only those two?

Priya: Only those two. There was a quarterly once, for one customer, and it caused so much trouble that we bought them out of it.

Facilitator: Can a subscription be both?

Priya: No. It's one or the other. You cannot bill someone monthly and annually for the same subscription, that's just billing them twice.

Facilitator: And it's never neither?

Priya: Never neither. Every subscription has exactly one billing period.

Facilitator: Good, that's a clean rule. Status?

Priya: Trialing, active, past due, cancelled.

Facilitator: Four. Every subscription in exactly one?

Priya: Exactly one, yes.

Tom: There's also paused.

Priya: Paused isn't a status, it's a flag.

Tom: It behaves like a status.

Priya: It behaves like a status but it isn't one, it's a separate boolean, which is exactly why it causes bugs. If you ask the system for active subscriptions you get paused ones too.

Facilitator: I'm going to record the four statuses as the status, and note that paused exists separately and overlaps confusingly. I'm not going to invent a fifth status you don't have.

Priya: Please don't. Finance reports off those four.

[Sam joins]

Sam (Revenue Analyst): Sorry. Board pack.

Facilitator: We've got: account identified by account number, subscription identified by subscription ID, one active subscription per account per product, billing period is monthly or annual exactly one, four statuses, start date mandatory, end date optional.

Sam: That all sounds right. Did you do MRR?

Facilitator: Not yet. Go on.

Sam: Every subscription has an MRR. Monthly recurring revenue. It's the number I live in.

Facilitator: Is MRR stored on the subscription?

Sam: It's on the subscription in the reporting layer.

Facilitator: That's not quite what I asked. In the source system, is MRR a field somebody sets, or is it worked out?

Sam: ...It's worked out. It's the plan price normalised to a month. An annual plan at 490 is an MRR of 40.83.

Priya: Nobody types an MRR anywhere. If they did we'd have a different set of problems.

Facilitator: So it's derived from the price plan and the billing period.

Sam: Derived. Yes. I called it a field because that's how I see it in my dashboards, but nothing writes it.

Facilitator: I'm not going to model it as an attribute of the subscription, then, because it isn't a fact anybody asserts -- it's a calculation over facts we already have. If we modelled it as stored we'd be inviting someone to set it independently and drift.

Sam: That's fair. It'd be wrong within a month.

Facilitator: Let's come back to plan, because we left it open. Tom, Priya -- are the two plans related, or genuinely separate things?

Tom: They're related. Every price plan gives you exactly one feature bundle. CORE-MO-49 and CORE-AN-490 both give you Professional.

Facilitator: So more than one price plan can point at the same bundle.

Tom: Several. There's a monthly and an annual for each bundle, and sometimes a legacy one we haven't retired.

Priya: And there are price plans that exist only for one customer. Bespoke enterprise pricing. Those still point at a bundle.

Facilitator: Does every price plan point at exactly one bundle? Never zero, never two?

Tom: Exactly one. A price plan that doesn't entitle you to anything would be a donation.

Facilitator: And can a bundle exist with no price plan pointing at it?

Tom: Yes -- we build a bundle before we price it. Enterprise existed for two months before there was anything to buy.

Facilitator: Good. So bundles and price plans are separate things, many price plans to one bundle, and the word "plan" on its own is ambiguous. What's the bundle identified by?

Tom: Name. Starter, Professional, Enterprise. There's no code, which annoys me.

Facilitator: Is the name unique?

Tom: Yes. There's exactly one Professional.

Facilitator: Then it's an identifier, even if it's an ugly one. Now -- plan changes. What happens when a customer moves from Starter to Professional?

Priya: This is where it gets unpleasant.

Tom: This is my favourite part.

Priya: It's your favourite part because you don't have to process the proration.

Facilitator: Walk me through it.

Priya: A change is a record. We don't overwrite the plan on the subscription, we write a plan change with an effective date, and the subscription's current plan is derived from the change history.

Facilitator: So a plan change is its own thing, with its own identity?

Priya: It's got a change ID. It has to, because we need to know who made it and when it takes effect, and those are different dates. Someone can make a change on the third that takes effect on the first of next month.

Facilitator: And a plan change belongs to exactly one subscription?

Priya: One change, one subscription. It records the subscription, the new price plan, the effective date, and who requested it.

Facilitator: Can a subscription have many changes?

Priya: Over its life, yes, plenty. Some of our older accounts have a dozen.

Facilitator: And a brand new subscription has none.

Priya: Right, none until something changes.

Sam: This is the bit that matters for revenue, by the way. If you model the subscription as having one plan, you lose the ability to say what the customer was paying in March.

Facilitator: Understood, and that's a good argument for the change record being real rather than a log.

Tom: Can I raise the thing I want to raise?

Facilitator: Go on.

Tom: Mid-term cancellation on annual plans. Someone signs an annual deal in January, pays up front, cancels in April. What happens?

Priya: Nothing happens. They've paid for the year, they keep access until December, we don't refund.

Tom: That's not what the pricing page implies and it's not what sales tell people.

Priya: What sales tell people is not a system rule.

Tom: It becomes one when the customer escalates and we give them a refund anyway, which we did four times last quarter.

Priya: Those were goodwill and they were signed off individually.

Tom: Four times in a quarter isn't goodwill, it's a policy nobody's written down.

Sam: I'd agree with Tom on that, actually. From a revenue perspective I need to know whether to treat those as contra-revenue or as a refund liability, and right now I decide case by case, which is not a thing an auditor enjoys.

Priya: Then let's write a policy. But I'm not inventing one in this room.

Facilitator: Is there a rule today that I could write down?

Priya: There's a system behaviour: cancellation on an annual subscription sets the end date to the paid-through date and access continues. There's no refund mechanism at all -- the four Tom's talking about were manual credits raised outside the subscription.

Facilitator: So the system rule is clear, and what's unclear is whether the system rule is the business rule.

Sam: That's exactly it.

Tom: And that's what needs deciding.

Priya: By finance and legal, not by us, and not today.

Facilitator: Then I'm parking it explicitly. What happens commercially when an annual subscription is cancelled mid-term -- run to term, prorated refund, or credit -- is undecided. The model will capture the system behaviour, which is that cancellation sets an end date and access runs to it, and it will not invent a refund concept that doesn't exist.

Sam: Put my name on wanting that resolved.

Facilitator: Noted. Let me read back and you stop me. An account is identified by an account number. A product is identified by a product code. A price plan is identified by a plan code and entitles exactly one feature bundle. A feature bundle is identified by its name. A subscription is identified by a subscription ID, and belongs to exactly one account, one product, and one price plan. Each account has at most one active subscription per product. A subscription has a start date, an optional end date, exactly one billing period which is monthly or annual, and exactly one status from trialing, active, past due, cancelled. A plan change is identified by a change ID, belongs to exactly one subscription, and records a new price plan, an effective date, and a requester. MRR is derived and not stored.

Sam: One correction. You said a subscription belongs to one price plan. It doesn't, really -- that's what the plan changes are for. The subscription's plan at any moment is derived.

Priya: No, Sam, it does have a current plan field. The changes are the history, but there's a denormalised current plan on the record.

Sam: Since when?

Priya: Since the reporting rebuild. It's maintained by the change process, nobody sets it by hand.

Sam: Then I withdraw the correction. Sorry.

Facilitator: That's worth having caught, though. So the subscription does carry a current price plan, and the change records are the history behind it.

Priya: Correct. And if those two ever disagree, the change history wins and the current plan is the bug.

Facilitator: Good. That's a rule too, and I'll note it. Anything else before we lose the room?

Tom: Only that we still call three different things "plan" and this document won't fix that.

Facilitator: It won't. But it'll at least name them separately, which is a start.
