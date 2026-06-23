# terminag

*terminag* is a controlled vocabuarly for organizing agricultural research data. It is organized in two main groups with tables (csv files).

- "variables" defines variable names and units, and, for numeric variables, a miniumum and maximum accepted value.
- "values" defines accepted values for some character variables. For example, country and crop names.

You can browse the tables [here](https://controvoc.github.io/terminag/)

The vocabulary is under development, we expand it as need arises. Please let us know if you would like to add terms, by raising an [issue](https://github.com/controvoc/terminag/issues/new) or with a message to carob-data@gmail.com. 

You can use *R* package [vocal](https://github.com/controvoc/vocal) to check for compliance with this vocabulary. You can also use `carobiner::check_terms` from *R* package [carobiner](https://github.com/carob-data/carobiner) or our [on-line checker](https://controvoc.github.io/terminag/check).

terminag is used by the [Carob](https://carob-data.org) project for standardizing agriculutral research data. 
