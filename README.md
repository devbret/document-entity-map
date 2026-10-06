# Document And Entity Map

![Screenshot featuring hundreds of document and entity nodes connected in a network graph.](https://hosting.photobucket.com/bbcfb0d4-be20-44a0-94dc-65bff8947cf2/eb820c24-8803-4dca-bb7c-187b7c5e0189.png)

Extract named entities from a collection of PDF and PowerPoint documents, then build an interactive D3 network graph linking each document to the entities it mentions.

## Application Overview

A Python script reads each file's text and runs `spaCy`'s named-entity recognizer over it, tallying how often each entity appears and in which documents, then folds shorter names into their fuller names to reduce duplication.

The result is written so every document and every entity is a node and a weighted link connects a document to each entity it mentions. Because an entity showing up in two documents becomes a single shared node, the graph reveals at a glance which documents are related through what they have in common.

Finally, a browser-based frontend renders this JSON file as a D3 network graph where you can filter by entity type, cap how many entities appear, require a minimum document presence and hover for entity details.

A document collection analysis modal reflects the full dataset rather than only the rendered nodes. Which includes summary charts, similar document pairs, data-quality view listing and other analyses.

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

8. Add your PDF and PPTX files to the `input` directory

9. Run the script: `python3 app.py`

10. Start an HTTP server: `python3 -m http.server`

11. Visit the frontend in a browser: `http://127.0.0.1:8000/`

12. When finished, shutdown the HTTP server: `CTRL + C`

13. Exit the virtual environment: `deactivate`

## Other Considerations

Below you will find information not covered in the installation and use sections above. Including the abilities this repo is intended to demonstrate. As well as an overview of the license this code is made available with. And a way to contact the maintainer with questions, suggestions and collaboration opportunities.

### Abilities Demonstrated

This project repo is intended to demonstrate an ability to do the following:

- Extract named entities mentioned across a collection of PDF and PowerPoint documents using `spaCy`'s named-entity recognizer

- Consolidate each entity into a single shared node so an entity discussed in several documents links them together

- Build a JSON file which connects every document to the entities it mentions, weighted by how often each entity appears

- Render the JSON file in an interactive network graph where you can filter by entity type, spotlight nodes and hover for document and entity details

- Analyze the whole collection of input documents by document similarity, entity co-occurrence, summary charts and more

### License Information

This repository is distributed under the MIT License. You are free to use, copy, modify, merge, publish, distribute, sublicense and sell copies of this software, including as part of proprietary or commercial work. The single condition is the copyright and permission notices contained in the LICENSE file must be included with any copy or substantial portion of the software that you redistribute. The software is provided "as is", without warranty of any kind, and the copyright holder is not liable for any claim or damages arising from its use.

If you have any questions or would like to collaborate, please reach out either on GitHub or via [my website](https://bretbernhoft.com/).
