So, i've been in the web development business for over 20 years.  From my understanding, majority of businesses like mine, handle a variety of new web development projects and development support.  I've been using AI a lot in my development workflow in both new projects and support.  

Personally, i've been using AI a lot in my development workflow.  When it comes to the spectrum of mission critical work down to basic experimentation work, my workflow with using AI is quite different.  For mission critical work, I would usually drive the architecture first for the feature, and then use AI to help with defining the contents of functions.  If there is some unique logic required in functions, I would directly write out the logic in comments.

I don't know, maybe i'm old school.  But, there is definitely 2 schools of thought out there, either take it slow, or, just use AI with everything.  Especially with this whole idea of loops, I really don't understand.  Actually, not that I don't understand, I don't really agree with it.  The idea of using loops is that you are essentially defining winning conditions for something, and you keep looping until all winning conditions are met.  So, lets say you write a test as a winning condition for a feature you want to write.  You then write logic for your AI to continuously loop through its coding mechanism until the winning condition is met.  If you've done this, and your burning through tokens, its because the LLM will keep making lots of mistakes on the way to getting that winning condition.  If you've ever coded with AI, you know the LLM creates duplicate code and dead code all over the place.  If you've also worked on creating tests with LLM, there is also the chance that the LLM will skip tests or find workarounds to make tests pass.  My gut feeling is that this code will be rediculous to handle after its complete.  Finally, i'm pretty sure this method has the greatest success with the latest and greatest models only.

Personally, when i'm using AI, I don't want to be locked-in to a specific model.  I'd rather create tooling around my workflow to allow me to effectively use AI as a really powerful assistant, where I could switch to different models, but control my consistency in my work and workflow.  I feel like this is the best way for me to be effective, and not be a slave to how models act and behave.  

Naturally, models will be better and different models will release.  My goal is that my work doesn't get interrupted.  I need consistency.  The entire AI arena is still moving very fast, there is definitely no benefit in holding back, but between all the noise of AI's supremacy, I think its very important to maintain a balance of control in the use of AI.  Don't let it lead your way, make sure you continue to lead the way.  Think of Luke Skywalker and C3PO's relationship.  Clearly, C3PO has superior knowledge, but there is a clear understanding that Luke is his master and C3PO is there to support Luke.

-----

So, I got word that Amex has a really good loan program.  Now, I'm not peddling loans.  Loans are bad if you're bad at managing finances, but they are definitely a good way to utilize and access capital if you need it.  Anyway, I called them, its true, their program is really good, but this isn't about the loan program (called Amex Access it if interested).  When it comes to detailed questions, about interest vs principle vs early repayment vs cancellation mid-month etc, the person on the line really didn't know too much.  So I thought... hey, GLM 5.1 suppose to have some good math capabilities, why not give it a try?  Anyway, I gave it the FAQ page, the quoted loan amount, and then asked some clarifying questions.  What I found pretty cool was how GLM deep thinking worked, once I gave it my quoted rate, it was trying HARD to figure out the math... it was constantly recalculating, questioning its own assumptions (based on the FAQ and its own calculations)... it was quite amusing how it came up with the finalized information.  Anyway, my session trace is here - https://lnkd.in/gcX7MvUX - you can see the entire Pi thinking trace from system message, down to my messages, thinking traces... and final result.  People that use Pi is probably familiar with this, but, for people that don't maybe its something you find "interesting" as well.  If you want to see the session, just download the file, and open it (should just open a browser of the file since its html).

-----

Was trying to help someone on reddit with some issues they were having with Pi.  Communicating and helping people that are starting off in the industry or having problems is important, but, this was an example of the importance of having some base  understanding of coding to help you along the way in whatever coding journey you're taking: https://lnkd.in/gan4fkv9

I think getting into coding is great, even with AI today.  But, the fundamentals are still important.

-----

Hmmmm.  I was working on revamping one of my ecommerce sites with some new features.  I generally do my own designs.  But I heard about Google Stitch, so I decided why not give it a try.  I dunno, I care about UI/UX, this looks decent, needs cleanup, and fixes here and there.  But, my first thought is that its definitely useable by non designers to quickly generate and brainstorm ideas before passing to a designer.  I could see why tools like this hurts designers though.  This does have a wow factor, where given enough context, just presents something within a short period of time.  Companies that don't understand the value of good UI/UX would easily jump onto a design like this without a second thought.  The idea of saving dollars is probably top of mind for startups.  

But, what people don't understand is that DESIGN MATTERS.  GOOD UI/UX MATTERS.  A good design WILL CONVERT BETTER.  UGHHHH, unfortunately, proof is in the pudding... but you need to put out the moola before you can see the proof... 

Anyway, if I start building with this design, don't shoot the messenger please, I'm doing this on a limited budget ;)

-----

For those people that are deep into coding agents.  

Today, most coding agents spawn sub-agents to perform different tasks on a codebase.  Most would understand this at a very high level, that is, the LLM model has limited context.  So, these spawned agents would use their own limits and pull in the relevant context, then spit out what they find back to the orchestrator.

Now, I've been thinking about how to optimize a single agent to be able to optimize the use of the context limit.  If you can offload the analyzing away from the LLM, using some external application/script/tooling, the LLM essentially can get the necessary context, without eating up tokens.  Doing it efficiently can essentially save more than 50% of tokens necessary (theoretical only, based on some rudimentary tests on something i've been working on).

Traditional tools are already available (AST, Ctags, LSP...), but the strategy could always be optimized based on the language and methodology.  If i'm correct, I believe OpenCode uses the LSP strategy, which I learned from a video from Mario Zechner that complained about that strategy.  Anyway, wanted to share thoughts.  The point being, even coding agent technology is still in the very early stages.  Performance optimization on token utilization is important.  Yeah, tokens will get cheaper, but cheaper tokens, means greater utilization.  The AI boom will still continue for a while, so I believe its important to still consider how to optimize token useage, especially today, where people are crazily burning through tokens.

-----

So, I have a business in Hong Kong that is coming time to do my Profit Tax Returns.  This business has been pretty dormant in the last year has an overall net loss (business registration + some accounting fees).  I don't want to go through my accountant and pay fees, but, I still got to do my financials and come up with P&L, balance sheets, cash flow statements etc.  The accounts are pretty easy, only had bank statements and credit card, which had the most movement as I still have a website running (which i'm planning on doing some AI related things in the coming year).  I just happen to be doing some side project which can pretty much extract anything from PDF's or images (when I say anything, it can do any type of extraction).  So, I paired this tool together with my Pi coding agent, and just went ahead with doing all my paper work.  Just for fun, I also extracted the BIR51 form, and asked my agent to do a prefill of the form, then, also create a supplementary page, letting me know the logic and source for filling in those sections.  

Anyway, reality wise, this won't cut it.  Hong Kong requires an audit of financials regardless of business situation, the cost of auditing and preparing the financials for a company like this is about HK$4-7k.  This just sounds like an opportunity that a startup can cut into.  I dunno, definitely a pain point I can see where you may have a somewhat inactive company that your holding onto (like myself), but want to keep it for some future endeavor, since opening it require doing a bit of paperwork.  

Anybody interested?  
Anybody have this pain point?  
Anybody want to work on this?  

I know there is the privacy issue, which I've already thought of and have a solution for.  But wondering about market viability and interest.

-----

As a developer in the branding web dev space, I could say with certainty, AI CANNOT FULLY REPLACE A PERSON.  If you've ever handled a real client project, you'll know what I mean.  Try vibe coding a signed off design, created by a designer, with clear specs for sizing and spacing. No vibe coding can get you past the sign off for your work, unless the client is willing to diverge from sign-off.  AI can definitely help with some of my previous workflow, but for these types of projects, it has to be collaborative with the LLM and never with CLI coding agent. 

I think at the moment, the best pairing for that type of work is Cursor.  I've had the best experience so far.  Since you need to be surgical and precise with what you change, you need to select the parts of code you need to update or refine, a CLI don't have that ability. 

-----

I know I've been talking a lot about Pi, but haven't given much credit to Cursor.  I still use Cursor quite a lot.  The $20/month plan goes a REALLY LONG WAY.  But more importantly, I find it has 2 great features that people don't talk about, but I know I use a lot.

1. Browser - allow me to open up a site (either local, or on production - even if there is zero link between my local files and production) - and make visual changes a lot easier.  The old days of editing styles, finding classes, etc. are now gone in my workflow.  

2. Not much people talk about the debug window - or I haven't seen people talk about it, but its one of those features that I use a ton when debugging issues on a production site.  I liken this feature to xdebug for php + console logging on steroids (or echo ... or whatever manual method you used before).  It's been great at targeting and finding issues in a relatively non-invasive way on production code as everything is analyzed through logs sent to your local.

All this talk about CLI products, but people forget that the IDE is still an important daily driver, its not always about bells and whistles.  You still have to work with frontend designs, debug website... your regular day to day drudgery and code review (like really reading the code) is still important.  From what I've seen, LLM's still make mistakes... actually, let me rephrase that.  They make duplicate code, sometimes use incorrect casing to reference methods/functions... just booboos here and there.  They are good, but I'm not so sure about fire and forget vibe coding.  I do vibe code on personal products to see the strengths and weaknesses, and I definitely have lots of fun.
