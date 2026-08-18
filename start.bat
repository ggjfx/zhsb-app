@echo off
chcp 65001 >nul
title 升本英语通 本地服务器
start "" "http://localhost:8080"
node "%~dp0server.js"
pause
