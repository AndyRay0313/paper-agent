from langchain.tools import tool
import requests
import xml.etree.ElementTree as ET


@tool
def search_arxiv(query: str) -> str:
    """
    搜索 arxiv 论文
    """

    url = (
        f"http://export.arxiv.org/api/query?"
        f"search_query=all:{query}"
        f"&start=0"
        f"&max_results=3"
    )

    headers = {
        "User-Agent": "paper-agent/0.1"
    }

    response = requests.get(url, headers=headers)

    if response.status_code != 200:
        return f"arxiv API error: {response.status_code}"

    root = ET.fromstring(response.text)

    ns = {
        "atom": "http://www.w3.org/2005/Atom"
    }

    entries = root.findall("atom:entry", ns)

    papers = []

    for entry in entries:

        title = entry.find("atom:title", ns).text.strip()

        summary = entry.find(
            "atom:summary",
            ns
        ).text.strip()

        papers.append(
            f"""
Title: {title}

Summary: {summary[:300]}
"""
        )

    return "\n\n".join(papers)