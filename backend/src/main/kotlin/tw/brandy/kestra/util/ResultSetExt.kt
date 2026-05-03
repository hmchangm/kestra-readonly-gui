package tw.brandy.kestra.util

import java.sql.ResultSet

fun <T> ResultSet.toList(mapper: (ResultSet) -> T): List<T> =
    generateSequence { if (next()) mapper(this) else null }.toList()
