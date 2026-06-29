# Document And Entity Map

![Screenshot featuring hundreds of document and entity nodes connected in a network graph.](https://hosting.photobucket.com/bbcfb0d4-be20-44a0-94dc-65bff8947cf2/5ddcf9f0-cd7c-40c1-8a3d-168554cb3bb4.png)

Extract named entities from a collection of PDF and PowerPoint documents, then build an interactive D3 network graph linking each document to the entities it mentions.

## Application Overview

A Python script reads each file's text and runs `spaCy`'s named-entity recognizer over it, tallying how often each entity appears and in which documents, then folds shorter names into their fuller names to reduce duplication.

The result is written so every document and every entity is a node and a weighted link connects a document to each entity it mentions. Because an entity showing up in two documents becomes a single shared node, the graph reveals at a glance which documents are related through what they have in common.

Finally, a browser-based frontend renders this JSON file as a D3 network diagram where you can filter by entity type, cap how many entities appear, spotlight nodes and hover for entity and document details.

## Basic Setup Instructions

Below are the required software programs and set up steps for running this application on a Linux machine.

### Programs Needed

- [Git](https://git-scm.com/downloads)

- [Python](https://www.python.org/downloads/)

### Steps

1. Install the above programs

2. Open a terminal

3. Clone this repository: `git clone git@github.com:devbret/document-entity-map.git`

4. Navigate to the repo's directory: `cd document-entity-map`

5. Create a virtual environment: `python3 -m venv venv`

6. Activate your virtual environment: `source venv/bin/activate`

7. Install the needed dependencies: `pip install -r requirements.txt`

8. Download the English model used for entity recognition: `python -m spacy download en_core_web_sm`

9. Add your PDF and PPTX files to the `input` directory

10. Run the script: `python3 app.py`

11. Start an HTTP server: `python3 -m http.server`

12. Visit the frontend in a browser: `http://127.0.0.1:8000/`

13. When finished, shutdown the HTTP server: `CTRL + C`

14. Exit the virtual environment: `deactivate`

## Other Considerations

This project repo is intended to demonstrate an ability to do the following:

- Extract named entities mentioned across a collection of PDF and PowerPoint documents using `spaCy`'s named-entity recognizer

- Consolidate each entity into a single shared node so an entity discussed in several documents links them together

- Build a JSON file which connects every document to the entities it mentions, weighted by how often each entity appears

- Render the JSON file in an interactive network graph where you can filter by entity type, spotlight nodes and hover for document and entity details

If you have any questions or would like to collaborate, please reach out either on GitHub or via [my website](https://bretbernhoft.com/).
