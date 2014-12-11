#!/bin/bash

#tell grid engine to use current directory
#$ -cwd

nodejs bot.js --nolog --startchallenging --ranked
