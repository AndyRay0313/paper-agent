import os

from dotenv import load_dotenv

from langchain_openai import ChatOpenAI
from langchain.agents import initialize_agent
from langchain.agents import AgentType

from tools import search_arxiv
from prompts import SYSTEM_PROMPT
from state import state


# 加载 .env
load_dotenv()

# 获取 API KEY
api_key = os.getenv("DEEPSEEK_API_KEY")


# 初始化 LLM
llm = ChatOpenAI(
    api_key=api_key,
    base_url="https://api.deepseek.com",
    model="deepseek-v4-pro",
    temperature=0
)


# 注册 tools
tools = [search_arxiv]


# 初始化 Agent（接入 system prompt）
agent = initialize_agent(
    tools=tools,
    llm=llm,
    agent=AgentType.ZERO_SHOT_REACT_DESCRIPTION,
    verbose=True,
    agent_kwargs={"prefix": SYSTEM_PROMPT}
)


# 用户输入
query = input("请输入问题: ")


# Agent 执行
response = agent.invoke({
    "input": query
})


# 存入 state
state["messages"] = [query, response["output"]]
state["final_answer"] = response["output"]

# 输出结果
print("\n[FINAL ANSWER]")
print(response["output"])
