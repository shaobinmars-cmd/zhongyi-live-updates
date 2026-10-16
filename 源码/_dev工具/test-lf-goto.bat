@echo off
rem Dev-only: does an LF-only .bat resolve goto labels on this Windows build?
echo STEP_A
goto :done
echo STEP_B_SHOULD_BE_SKIPPED
:done
echo STEP_C
call :sub
echo STEP_E
exit /b 0

:sub
echo STEP_D_SUB
exit /b 0
