# Cangshu Pavilion

This context helps an individual researcher turn imported material into verifiable answers and durable notes. Each Notebook is an independent research boundary.

## Language

**Researcher**:
The single person who controls the deployment and owns every Notebook and Note in it.
_Avoid_: User, account, tenant

**Notebook**:
A user-created research collection that contains Sources, Conversations, and Notes and defines the boundary for retrieval.
_Avoid_: Workspace, project, knowledge base

**Source**:
Original material imported into exactly one Notebook for processing and research.
_Avoid_: Document, file, resource

**Passage**:
An ordered excerpt from one Source that preserves an exact locator and can be retrieved as evidence for a Grounded Answer.
_Avoid_: Chunk, segment, embedding row

**Conversation**:
An ordered exchange between the researcher and the assistant within one Notebook.
_Avoid_: Thread, chat session

**Citation**:
A verifiable reference from an answer to an exact location and matching excerpt in a Source.
_Avoid_: Reference, source link

**Grounded Answer**:
An assistant response whose factual claims are supported only by Sources in the current Notebook and whose key claims carry Citations.
_Avoid_: AI answer, chat response

**Note**:
A durable research artifact owned by the researcher, written manually or saved from an answer.
_Avoid_: Insight, memo, generated artifact
